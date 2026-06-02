import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import { Lock, Edit2, Save, Activity, Trash2, Shield, Zap, X, MessageCircle, Download } from 'lucide-react';
import clsx from 'clsx';
import wechatQr from './wechat_qr.png';

const isProd = import.meta.env.PROD;
const API_BASE_URL = isProd ? '/fenshu/api' : 'http://localhost:3001/api';
const SOCKET_URL = isProd ? window.location.origin : 'http://localhost:3001';
const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true
});
const INSTITUTION_OPTIONS = ['智狐', '默默学', '同方', '兴国', '新程'];
const CUSTOM_INSTITUTION_VALUE = '__custom__';

const BATCH_TYPES = {
  NORMAL: 'normal',
  RETIRED: 'retired'
};

const BATCH_META = {
  [BATCH_TYPES.NORMAL]: {
    label: '普通批次'
  },
  [BATCH_TYPES.RETIRED]: {
    label: '退役批次'
  }
};

const BATCH_STORAGE_KEY = 'selectedBatchType';
const LEGACY_KEYS = {
  id: 'myId',
  name: 'myName',
  editKey: 'editKey'
};
const EXPORT_HEADERS = ['姓名', '机构', 'QQ号', '高数成绩', '外语成绩', '理论成绩', '实操成绩', '总分'];

const getBatchUserStorageKey = (batchType) => `fenshu_user_${batchType}`;

const parseStoredId = (value) => {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const getStoredBatchType = () => {
  const stored = String(localStorage.getItem(BATCH_STORAGE_KEY) || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(BATCH_META, stored) ? stored : null;
};

const getStoredBatchUser = (batchType) => {
  const empty = { id: null, name: '', editKey: '' };
  const storageKey = getBatchUserStorageKey(batchType);

  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        id: parseStoredId(parsed?.id),
        name: String(parsed?.name || ''),
        editKey: String(parsed?.editKey || '')
      };
    }
  } catch (error) {
    console.warn('Failed to parse local user cache:', error);
  }

  if (batchType === BATCH_TYPES.NORMAL) {
    return {
      id: parseStoredId(localStorage.getItem(LEGACY_KEYS.id)),
      name: String(localStorage.getItem(LEGACY_KEYS.name) || ''),
      editKey: String(localStorage.getItem(LEGACY_KEYS.editKey) || '')
    };
  }

  return empty;
};

const persistBatchUser = (batchType, payload) => {
  const normalized = {
    id: parseStoredId(payload?.id),
    name: String(payload?.name || ''),
    editKey: String(payload?.editKey || '')
  };

  localStorage.setItem(getBatchUserStorageKey(batchType), JSON.stringify(normalized));

  if (batchType === BATCH_TYPES.NORMAL) {
    if (normalized.id) {
      localStorage.setItem(LEGACY_KEYS.id, String(normalized.id));
    } else {
      localStorage.removeItem(LEGACY_KEYS.id);
    }
    localStorage.setItem(LEGACY_KEYS.name, normalized.name);
    localStorage.setItem(LEGACY_KEYS.editKey, normalized.editKey);
  }
};

const buildInitialFormData = (batchType, seed = {}) => ({
  name: String(seed.name || ''),
  institution: String(seed.institution || ''),
  qq: String(seed.qq || ''),
  highMath: seed.highMath ?? '',
  english: seed.english ?? '',
  compTheory: seed.compTheory ?? '',
  compPractical: seed.compPractical ?? '',
  volunteers: Array.isArray(seed.volunteers) ? seed.volunteers : [],
  editKey: String(seed.editKey || '')
});

const calculateTotalScore = (score, batchType) =>
  batchType === BATCH_TYPES.RETIRED
    ? score.compTheory
    : (score.highMath + score.english + score.compTheory + score.compPractical);

const formatExportTimestamp = (date = new Date()) => {
  const pad = (value) => String(value).padStart(2, '0');

  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
};

const buildExportRow = (score, batchType) => {
  const isRetiredBatch = batchType === BATCH_TYPES.RETIRED;

  return [
    score.name || '',
    score.institution || '',
    score.qq || '',
    isRetiredBatch ? '' : score.highMath,
    isRetiredBatch ? '' : score.english,
    score.compTheory ?? '',
    isRetiredBatch ? '' : score.compPractical,
    calculateTotalScore(score, batchType)
  ];
};

function App() {
  const [selectedBatch, setSelectedBatch] = useState(() => {
    try {
      return getStoredBatchType();
    } catch (error) {
      return null;
    }
  });

  const [scores, setScores] = useState([]);
  const [myId, setMyId] = useState(null);
  const [myName, setMyName] = useState('');
  const [editKey, setEditKey] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [showConsultModal, setShowConsultModal] = useState(false);

  const [isAdmin, setIsAdmin] = useState(false);
  const [isRefreshingAdmin, setIsRefreshingAdmin] = useState(false);
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [adminCode, setAdminCode] = useState('');
  const [isCustomInstitution, setIsCustomInstitution] = useState(false);

  const [formData, setFormData] = useState(() => buildInitialFormData(BATCH_TYPES.NORMAL));

  const isRetiredBatch = selectedBatch === BATCH_TYPES.RETIRED;

  useEffect(() => {
    if (!selectedBatch) {
      setScores([]);
      setMyId(null);
      setMyName('');
      setEditKey('');
      setIsEditing(false);
      return;
    }

    localStorage.setItem(BATCH_STORAGE_KEY, selectedBatch);
    const storedUser = getStoredBatchUser(selectedBatch);
    setMyId(storedUser.id);
    setMyName(storedUser.name);
    setEditKey(storedUser.editKey);
    setIsCustomInstitution(false);
    setIsEditing(false);
    setFormData(buildInitialFormData(selectedBatch, {
      name: storedUser.name,
      editKey: storedUser.editKey
    }));
  }, [selectedBatch]);

  const refreshAdminSession = useCallback(async () => {
    try {
      setIsRefreshingAdmin(true);
      const res = await api.get('/admin/session');
      const authenticated = Boolean(res.data?.authenticated);
      setIsAdmin(authenticated);
      return authenticated;
    } catch (error) {
      setIsAdmin(false);
      return false;
    } finally {
      setIsRefreshingAdmin(false);
    }
  }, []);

  useEffect(() => {
    localStorage.removeItem('adminToken');
    localStorage.removeItem('adminTokenExp');
    refreshAdminSession();
  }, [refreshAdminSession]);

  const fetchScores = useCallback(async () => {
    if (!selectedBatch) return;

    try {
      const res = await api.get('/scores', {
        params: {
          myId,
          batchType: selectedBatch
        }
      });
      setScores(res.data);
    } catch (err) {
      console.error('Failed to fetch scores', err);
    }
  }, [selectedBatch, myId]);

  useEffect(() => {
    if (!selectedBatch) return undefined;

    const socket = io(SOCKET_URL, {
      path: isProd ? '/fenshu/socket.io' : '/socket.io'
    });

    socket.on('update_scores', () => {
      fetchScores();
    });

    return () => socket.disconnect();
  }, [fetchScores, selectedBatch]);

  useEffect(() => {
    if (!selectedBatch) return;
    fetchScores();
  }, [fetchScores, isAdmin, selectedBatch]);

  const parseScore = (value) => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const validateScoreLimits = () => {
    const limits = isRetiredBatch
      ? [{ key: 'compTheory', label: '理论成绩', max: 150 }]
      : [
          { key: 'highMath', label: '高数成绩', max: 150 },
          { key: 'compTheory', label: '理论成绩', max: 150 },
          { key: 'compPractical', label: '实操成绩', max: 80 },
          { key: 'english', label: '外语成绩', max: 120 }
        ];

    for (const item of limits) {
      const score = parseScore(formData[item.key]);
      if (score > item.max) {
        alert(`${item.label}不能大于${item.max}分，请重新输入`);
        return false;
      }
    }

    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!selectedBatch) {
      alert('请先选择批次');
      return;
    }

    try {
      const normalizedName = String(formData.name || '').trim();
      if (!normalizedName) {
        alert('请填写姓名');
        return;
      }

      const normalizedInstitution = String(formData.institution || '').trim();
      if (!normalizedInstitution) {
        alert('请选择或填写机构名称');
        return;
      }

      if (!isRetiredBatch && !String(formData.qq || '').trim()) {
        alert('请填写QQ联系方式');
        return;
      }

      if (!String(formData.editKey || '').trim()) {
        alert('请设置一个修改密码，以便后续修改/找回数据');
        return;
      }

      if (!validateScoreLimits()) {
        return;
      }

      const payload = {
        ...formData,
        batchType: selectedBatch,
        name: normalizedName,
        institution: normalizedInstitution,
        volunteers: []
      };

      payload.editKey = String(formData.editKey || '').trim();
      payload.qq = isRetiredBatch ? '' : String(formData.qq || '').trim();

      if (isRetiredBatch) {
        payload.highMath = 0;
        payload.english = 0;
        payload.compPractical = 0;
      }

      const res = await api.post('/scores', payload);
      const { id, isUpdate } = res.data.data;
      const nextUser = {
        id,
        name: normalizedName,
        editKey: payload.editKey
      };

      persistBatchUser(selectedBatch, nextUser);
      setMyId(nextUser.id);
      setMyName(nextUser.name);
      setEditKey(nextUser.editKey);

      alert(isUpdate ? '更新成功！' : '登记成功！');
      setIsEditing(false);
      fetchScores();
    } catch (err) {
      alert(err.response?.data?.error || '操作失败');
    }
  };

  const handleEditClick = (record) => {
    if (!selectedBatch) return;

    if (!record) {
      setIsCustomInstitution(false);
      setFormData(buildInitialFormData(selectedBatch, {
        name: myName || '',
        editKey: editKey || ''
      }));
      setIsEditing(true);
      return;
    }

    const institution = String(record.institution || '').trim();
    const useCustomInstitution = Boolean(institution) && !INSTITUTION_OPTIONS.includes(institution);
    setIsCustomInstitution(useCustomInstitution);
    setFormData(buildInitialFormData(selectedBatch, {
      name: record.name,
      institution,
      qq: record.qq || '',
      highMath: record.highMath,
      english: record.english,
      compTheory: record.compTheory,
      compPractical: record.compPractical,
      volunteers: [],
      editKey
    }));
    setIsEditing(true);
  };

  const handleAdminLogin = async (e) => {
    e.preventDefault();
    try {
      const code = String(adminCode || '').trim();
      if (!code) {
        alert('请输入6位动态码');
        return;
      }
      const res = await api.post('/admin/login', { code });
      if (res.data?.success) {
        await refreshAdminSession();
        setShowAdminLogin(false);
        setAdminCode('');
        fetchScores();
        alert('管理员登录成功');
      }
    } catch (err) {
      alert(err.response?.data?.error || '动态码错误或已过期');
    }
  };

  const handleAdminLogout = async () => {
    try {
      await api.post('/admin/logout');
    } catch (error) {
      // Continue local state reset even if request fails
    }
    setIsAdmin(false);
    fetchScores();
    refreshAdminSession();
  };

  const handleDelete = async (id) => {
    if (!confirm('确定要删除这条记录吗？')) return;

    try {
      await api.delete(`/admin/scores/${id}`);
      alert('删除成功');
      fetchScores();
    } catch (err) {
      if (err.response?.status === 401 || err.response?.status === 403) {
        alert('管理员登录已过期，请重新登录');
        setIsAdmin(false);
        setShowAdminLogin(true);
        refreshAdminSession();
        return;
      }
      alert(`删除失败: ${err.response?.data?.error || '未知错误'}`);
    }
  };

  const handleInstitutionSelectChange = (e) => {
    const value = e.target.value;
    if (value === CUSTOM_INSTITUTION_VALUE) {
      setIsCustomInstitution(true);
      setFormData((prev) => ({
        ...prev,
        institution: INSTITUTION_OPTIONS.includes(prev.institution) ? '' : prev.institution
      }));
      return;
    }

    setIsCustomInstitution(false);
    setFormData((prev) => ({ ...prev, institution: value }));
  };

  const handleBatchSelect = (batchType) => {
    if (batchType === selectedBatch) return;
    setSelectedBatch(batchType);
  };

  const handleExportExcel = async () => {
    if (!isAdmin) return;

    if (scores.length === 0) {
      alert('当前批次暂无可导出的成绩');
      return;
    }

    try {
      const XLSX = await import('xlsx');
      const worksheet = XLSX.utils.aoa_to_sheet([
        EXPORT_HEADERS,
        ...scores.map((score) => buildExportRow(score, selectedBatch))
      ]);

      worksheet['!cols'] = [
        { wch: 12 },
        { wch: 14 },
        { wch: 14 },
        { wch: 10 },
        { wch: 10 },
        { wch: 10 },
        { wch: 10 },
        { wch: 10 }
      ];

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, BATCH_META[selectedBatch].label);
      XLSX.writeFile(workbook, `${BATCH_META[selectedBatch].label}成绩_${formatExportTimestamp()}.xlsx`);
    } catch (error) {
      console.error('Failed to export excel', error);
      alert('导出失败，请稍后重试');
    }
  };

  const myRecord = useMemo(() => scores.find((s) => s.id === myId), [scores, myId]);

  const rankHint = isRetiredBatch ? '按理论成绩从高到低排列' : '按总分从高到低排列';
  const emptyColSpan = isAdmin
    ? (isRetiredBatch ? 5 : 9)
    : (isRetiredBatch ? 3 : 7);

  if (!selectedBatch) {
    return (
      <div className="min-h-screen bg-gray-50 p-4 md:p-8">
        <div className="max-w-md mx-auto pt-14 md:pt-24">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
              <Activity className="text-blue-600" />
              实时分数线登记系统
            </h1>
            <div className="mt-5 inline-flex rounded-lg bg-gray-100 p-1">
              {Object.entries(BATCH_META).map(([batchType, meta]) => (
                <button
                  key={batchType}
                  type="button"
                  onClick={() => handleBatchSelect(batchType)}
                  className="px-4 py-2 text-sm rounded-md text-gray-600 hover:text-gray-800 transition"
                >
                  {meta.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="bg-white rounded-xl shadow-sm p-6 flex flex-col md:flex-row justify-between items-center">
          <div>
            <div className="mb-3 inline-flex rounded-lg bg-gray-100 p-1">
              {Object.entries(BATCH_META).map(([batchType, meta]) => (
                <button
                  key={batchType}
                  type="button"
                  onClick={() => handleBatchSelect(batchType)}
                  className={clsx(
                    'px-3 py-1.5 text-sm rounded-md transition',
                    selectedBatch === batchType
                      ? 'bg-white text-blue-600 shadow-sm font-medium'
                      : 'text-gray-600 hover:text-gray-800'
                  )}
                >
                  {meta.label}
                </button>
              ))}
            </div>
            <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
              <Activity className="text-blue-600" />
              实时分数线登记系统
            </h1>
            <p className="text-gray-500 text-sm mt-1">
              当前为 {BATCH_META[selectedBatch].label}，共有 {scores.length} 位同学登记（{rankHint}）
            </p>
            <p className="text-gray-400 text-xs flex items-center gap-1 mt-1">
              <MessageCircle size={12} /> 反馈/联系QQ: 3311493401
            </p>
            {isAdmin && (
              <div className="mt-2 inline-flex items-center gap-2 text-xs bg-red-50 text-red-700 border border-red-200 px-2.5 py-1 rounded-full">
                <Shield size={12} /> 管理员模式（可删除记录）
              </div>
            )}
          </div>

          <div className="mt-4 md:mt-0 flex gap-3">
            {!isAdmin ? (
              <button
                onClick={() => setShowAdminLogin(true)}
                className="p-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100 transition"
                title="管理员登录"
              >
                <Shield size={20} />
              </button>
            ) : (
              <>
                <button
                  onClick={handleExportExcel}
                  className="px-3 py-1.5 text-xs text-emerald-700 border border-emerald-200 rounded hover:bg-emerald-50 transition flex items-center gap-1.5"
                  title={`导出${BATCH_META[selectedBatch].label}成绩`}
                >
                  <Download size={14} /> 一键导出Excel
                </button>
                <button
                  onClick={handleAdminLogout}
                  className="px-3 py-1.5 text-xs text-red-600 border border-red-200 rounded hover:bg-red-50 transition"
                  title="退出管理员"
                >
                  退出管理员
                </button>
              </>
            )}

            {!isAdmin && !myId ? (
              <button
                onClick={() => setIsEditing(true)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition flex items-center gap-2"
              >
                <Edit2 size={16} /> 登记 / 登录
              </button>
            ) : !isAdmin ? (
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-600">
                  欢迎回来, <span className="font-bold text-blue-600">{myRecord ? myRecord.name : (myName || '同学')}</span>
                  {!myRecord && <span className="text-red-400 ml-1 text-xs">(数据已重置)</span>}
                </span>
                <button
                  onClick={() => handleEditClick(myRecord)}
                  className={clsx(
                    'px-3 py-1.5 text-white text-sm rounded transition',
                    myRecord ? 'bg-green-600 hover:bg-green-700' : 'bg-orange-500 hover:bg-orange-600'
                  )}
                >
                  {myRecord ? '修改我的数据' : '重新登记数据'}
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {showAdminLogin && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white p-6 rounded-lg shadow-xl w-96">
              <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                <Shield size={20} className="text-blue-600" /> 管理员登录
              </h3>
              <form onSubmit={handleAdminLogin}>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  className="w-full border rounded px-3 py-2 mb-4"
                  placeholder="请输入 6 位动态码"
                  value={adminCode}
                  onChange={(e) => setAdminCode(e.target.value)}
                  autoFocus
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowAdminLogin(false)}
                    className="px-3 py-1.5 text-gray-600 hover:bg-gray-100 rounded"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={isRefreshingAdmin}
                    className="px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                  >
                    登录
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        <div className="bg-gradient-to-r from-indigo-500 to-purple-600 rounded-xl p-4 md:p-6 text-white shadow-lg flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="bg-white/20 p-3 rounded-lg backdrop-blur-sm">
              <Zap size={28} className="text-yellow-300" />
            </div>
            <div>
              <h3 className="text-xl font-bold flex items-center gap-2">
                27&28届智狐科技计算机/高数全程班 火热招生中！
                <span className="bg-yellow-400 text-purple-900 text-xs px-2 py-0.5 rounded-full font-extrabold">HOT</span>
              </h3>
              <p className="text-indigo-100 text-sm mt-1">
                985硕士授课 · 重点押题 · 全程答疑 · 助你一战上岸！
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowConsultModal(true)}
            className="bg-white text-indigo-600 hover:bg-indigo-50 px-6 py-2.5 rounded-lg font-bold shadow-md transition whitespace-nowrap"
          >
            立即咨询
          </button>
        </div>

        {isEditing && (
          <div className="bg-white rounded-xl shadow-lg p-6 border border-blue-100 animate-in fade-in slide-in-from-top-4">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              {isRetiredBatch
                ? (myId ? '修改退役批次信息' : '退役批次登记')
                : (myId ? '修改信息' : '用户登记 / 登录')}
              <span className="text-xs font-normal text-gray-400">
                （已登记用户输入姓名和密码即可自动登录修改）
              </span>
            </h2>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div className={clsx(
                'grid gap-4',
                isRetiredBatch ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-5'
              )}>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700">姓名</label>
                  <input
                    required
                    type="text"
                    className="w-full border rounded px-3 py-2"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="请输入真实姓名"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700">机构</label>
                  <select
                    required
                    className="w-full border rounded px-3 py-2 bg-white"
                    value={isCustomInstitution ? CUSTOM_INSTITUTION_VALUE : formData.institution}
                    onChange={handleInstitutionSelectChange}
                  >
                    <option value="">请选择机构</option>
                    {INSTITUTION_OPTIONS.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                    <option value={CUSTOM_INSTITUTION_VALUE}>其他（手动输入）</option>
                  </select>
                  {isCustomInstitution && (
                    <input
                      required
                      type="text"
                      className="w-full border rounded px-3 py-2"
                      value={formData.institution}
                      onChange={(e) => setFormData({ ...formData, institution: e.target.value })}
                      placeholder="请输入机构名称"
                    />
                  )}
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700 flex items-center gap-1">
                    <Lock size={14} /> 修改密码
                  </label>
                  <input
                    required
                    type="text"
                    className="w-full border rounded px-3 py-2 bg-yellow-50"
                    value={formData.editKey}
                    onChange={(e) => setFormData({ ...formData, editKey: e.target.value })}
                    placeholder="设置或输入已有密码"
                  />
                </div>

                {!isRetiredBatch && (
                  <div className="space-y-2 md:col-span-2 lg:col-span-2">
                    <label className="text-sm font-medium text-gray-700">QQ联系方式</label>
                    <input
                      required
                      type="text"
                      inputMode="numeric"
                      pattern="[1-9][0-9]{4,14}"
                      className="w-full border rounded px-3 py-2"
                      value={formData.qq}
                      onChange={(e) => setFormData({ ...formData, qq: e.target.value.replace(/\D/g, '') })}
                      placeholder="请输入QQ号"
                    />
                  </div>
                )}
              </div>

              {!isRetiredBatch ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-gray-50 p-4 rounded-lg">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700">高数成绩</label>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      max="150"
                      className="w-full border rounded px-3 py-2"
                      value={formData.highMath}
                      onChange={(e) => setFormData({ ...formData, highMath: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700">外语成绩 (折算后)</label>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      max="120"
                      className="w-full border rounded px-3 py-2"
                      placeholder="请填写折算后的分数"
                      value={formData.english}
                      onChange={(e) => setFormData({ ...formData, english: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700">理论成绩</label>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      max="150"
                      className="w-full border rounded px-3 py-2"
                      value={formData.compTheory}
                      onChange={(e) => setFormData({ ...formData, compTheory: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700">实操成绩</label>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      max="80"
                      className="w-full border rounded px-3 py-2"
                      value={formData.compPractical}
                      onChange={(e) => setFormData({ ...formData, compPractical: e.target.value })}
                    />
                  </div>
                </div>
              ) : (
                <div className="bg-gray-50 p-4 rounded-lg max-w-sm">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700">理论成绩（总分）</label>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      max="150"
                      className="w-full border rounded px-3 py-2"
                      value={formData.compTheory}
                      onChange={(e) => setFormData({ ...formData, compTheory: e.target.value })}
                      placeholder="请输入理论成绩"
                    />
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4 border-t">
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-2"
                >
                  <Save size={16} /> 保存提交
                </button>
              </div>
            </form>
          </div>
        )}

        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-center text-sm">
              <thead className="bg-gray-100 text-gray-600 font-medium border-b">
                <tr>
                  <th className="px-4 py-3 sticky left-0 bg-gray-100">姓名</th>
                  <th className="px-4 py-3">机构</th>
                  {isAdmin && <th className="px-4 py-3">QQ号</th>}
                  {isRetiredBatch ? (
                    <th className="px-4 py-3">理论成绩（总分）</th>
                  ) : (
                    <>
                      <th className="px-4 py-3">高数成绩</th>
                      <th className="px-4 py-3">外语成绩</th>
                      <th className="px-4 py-3">理论成绩</th>
                      <th className="px-4 py-3">实操成绩</th>
                      <th className="px-4 py-3">总分</th>
                    </>
                  )}
                  {isAdmin && <th className="px-4 py-3">操作</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {scores.map((score) => {
                  const totalScore = isRetiredBatch
                    ? score.compTheory
                    : (score.highMath + score.english + score.compTheory + score.compPractical);

                  return (
                    <tr
                      key={score.id}
                      className={clsx(
                        'hover:bg-gray-50 transition-colors',
                        score.id === myId && 'bg-blue-50 hover:bg-blue-100 font-medium'
                      )}
                    >
                      <td className="px-4 py-3 sticky left-0 bg-inherit flex items-center justify-center gap-2">
                        {score.name}
                        {score.id === myId && <span className="text-xs bg-blue-200 text-blue-800 px-1.5 rounded">我</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{score.institution || '-'}</td>
                      {isAdmin && (
                        <td className="px-4 py-3 text-gray-600">{score.qq || '-'}</td>
                      )}

                      {isRetiredBatch ? (
                        <td className="px-4 py-3 font-bold text-gray-800">{totalScore}</td>
                      ) : (
                        <>
                          <td className="px-4 py-3 text-gray-600">{score.highMath}</td>
                          <td className="px-4 py-3 text-gray-600">{score.english}</td>
                          <td className="px-4 py-3 text-gray-600">{score.compTheory}</td>
                          <td className="px-4 py-3 text-gray-600">{score.compPractical}</td>
                          <td className="px-4 py-3 font-bold text-gray-800">{totalScore}</td>
                        </>
                      )}

                      {isAdmin && (
                        <td className="px-4 py-3">
                          <button
                            onClick={() => handleDelete(score.id)}
                            className="text-red-500 hover:text-red-700 p-1 rounded hover:bg-red-50 transition"
                            title="删除记录"
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
                {scores.length === 0 && (
                  <tr>
                    <td colSpan={emptyColSpan} className="px-4 py-8 text-center text-gray-400">
                      暂无数据，快来抢占沙发！
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>

      {showConsultModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 animate-in fade-in">
          <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full overflow-hidden relative">
            <button
              onClick={() => setShowConsultModal(false)}
              className="absolute top-3 right-3 p-1 bg-black/10 hover:bg-black/20 rounded-full transition"
            >
              <X size={20} className="text-gray-600" />
            </button>
            <div className="p-6 text-center">
              <h3 className="text-xl font-bold text-gray-800 mb-2">扫码咨询课程</h3>
              <p className="text-gray-500 text-sm mb-4">添加好友请备注“咨询课程”</p>
              <div className="bg-gray-50 p-4 rounded-xl border border-dashed border-gray-200 inline-block">
                <img src={wechatQr} alt="咨询二维码" className="w-48 h-48 object-contain" />
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export default App;
