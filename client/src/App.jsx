import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useRef } from 'react';
import { io } from 'socket.io-client';
import { Edit2, Save, Activity, Trash2, Shield, Zap, X, MessageCircle, Download, Search, Plus, BarChart3, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import wechatQr from './wechat_qr.png';

const isProd = import.meta.env.PROD;
const API_BASE_URL = isProd
  ? (import.meta.env.VITE_API_BASE || '/fenshu/api')
  : 'http://localhost:3001/api';
const SOCKET_URL = isProd ? window.location.origin : 'http://localhost:3001';
const SOCKET_PATH = isProd
  ? (import.meta.env.VITE_SOCKET_PATH || '/fenshu/socket.io')
  : '/socket.io';
const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true
});
const requestScoreSubmitToken = async () => {
  const res = await api.get('/score-submit-token');
  const token = String(res.data?.token || '').trim();
  if (!token) {
    throw new Error('Missing score submit token');
  }
  return token;
};
const DEFAULT_INSTITUTION = '智狐';
const INSTITUTION_OPTIONS = [DEFAULT_INSTITUTION];
const CUSTOM_INSTITUTION_VALUE = '__custom__';
const NORMAL_FIRST_CHOICE_THRESHOLD = 380;
const SCORE_PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
const DEFAULT_SCORE_PAGE_SIZE = 20;
const AUTO_REFRESH_INTERVAL_MS = 5000;
const SOCKET_REFRESH_DEBOUNCE_MS = 1000;
const NORMAL_FIRST_CHOICE_OPTIONS = [
  '常州大学 计算机科学与技术',
  '常州大学 软件工程',
  '苏州科技大学 计算机科学与技术',
  '其他'
];
const RANK_COLUMN_WIDTH = 72;
const NAME_COLUMN_WIDTH = 120;

const BATCH_TYPES = {
  NORMAL: 'normal',
  RETIRED: 'retired',
  ADMISSION: 'admission',
  ADMISSION_RETIRED: 'admission_retired'
};

const ADMIN_ENTRY_PATH = import.meta.env.VITE_ADMIN_PATH || '/fenshu/admin-2026';

const BATCH_META = {
  [BATCH_TYPES.NORMAL]: {
    label: '成绩登记（普通批次）',
    title: '实时分数线登记系统',
    rankHint: '按总分从高到低排列'
  },
  [BATCH_TYPES.RETIRED]: {
    label: '成绩登记（退役批次）',
    title: '实时分数线登记系统',
    rankHint: '按分数从高到低排列'
  },
  [BATCH_TYPES.ADMISSION]: {
    label: '录取结果（普通批次）',
    title: '录取结果登记系统',
    rankHint: '按录取分数从高到低排列'
  },
  [BATCH_TYPES.ADMISSION_RETIRED]: {
    label: '录取结果（退役批次）',
    title: '录取结果登记系统',
    rankHint: '按录取分数从高到低排列'
  }
};

const ADMIN_TOTAL_META = {
  [BATCH_TYPES.NORMAL]: { label: '总分', max: 500 },
  [BATCH_TYPES.RETIRED]: { label: '分数', max: 150 },
  [BATCH_TYPES.ADMISSION]: { label: '录取分数' },
  [BATCH_TYPES.ADMISSION_RETIRED]: { label: '录取分数' }
};

const DEFAULT_APP_TITLE = '实时登记系统';
const UI_BUILD_VERSION = '20260507-admission-recommended-stats';

const BATCH_STORAGE_KEY = 'selectedBatchType';
const LEGACY_KEYS = {
  id: 'myId',
  name: 'myName'
};

const getBatchUserStorageKey = (batchType) => `fenshu_user_${batchType}`;
const normalizePathname = (pathname) => {
  const normalized = String(pathname || '').replace(/\/+$/, '');
  return normalized || '/';
};

const parseStoredId = (value) => {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const getStoredBatchType = () => {
  const stored = String(localStorage.getItem(BATCH_STORAGE_KEY) || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(BATCH_META, stored) ? stored : null;
};

const getStoredBatchUser = (batchType) => {
  const empty = { id: null, name: '' };
  const storageKey = getBatchUserStorageKey(batchType);

  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        id: parseStoredId(parsed?.id),
        name: String(parsed?.name || '')
      };
    }
  } catch (error) {
    console.warn('Failed to parse local user cache:', error);
  }

  if (batchType === BATCH_TYPES.NORMAL) {
    return {
      id: parseStoredId(localStorage.getItem(LEGACY_KEYS.id)),
      name: String(localStorage.getItem(LEGACY_KEYS.name) || '')
    };
  }

  return empty;
};

const persistBatchUser = (batchType, payload) => {
  const normalized = {
    id: parseStoredId(payload?.id),
    name: String(payload?.name || '')
  };

  localStorage.setItem(getBatchUserStorageKey(batchType), JSON.stringify(normalized));

  if (batchType === BATCH_TYPES.NORMAL) {
    if (normalized.id) {
      localStorage.setItem(LEGACY_KEYS.id, String(normalized.id));
    } else {
      localStorage.removeItem(LEGACY_KEYS.id);
    }
    localStorage.setItem(LEGACY_KEYS.name, normalized.name);
    localStorage.removeItem('editKey');
  }
};

const buildInitialFormData = (seed = {}) => ({
  name: String(seed.name || ''),
  institution: String(seed.institution ?? DEFAULT_INSTITUTION),
  qq: String(seed.qq || ''),
  highMath: seed.highMath ?? '',
  english: seed.english ?? '',
  compTheory: seed.compTheory ?? '',
  compPractical: seed.compPractical ?? '',
  isRecommended: seed.isRecommended === true
    ? 'yes'
    : seed.isRecommended === false
      ? 'no'
      : String(seed.isRecommended || ''),
  firstChoice: String(seed.firstChoice || ''),
  admissionScore: seed.admissionScore ?? '',
  admissionSchool: String(seed.admissionSchool || ''),
  admissionMajor: String(seed.admissionMajor || ''),
  volunteers: Array.isArray(seed.volunteers) ? seed.volunteers : []
});

const createAdminAddDraft = () => ({
  name: '',
  totalScore: '',
  institution: '',
  qq: '',
  highMath: '',
  english: '',
  compTheory: '',
  compPractical: '',
  isRecommended: 'no',
  firstChoice: '',
  admissionSchool: '',
  admissionMajor: ''
});

const formatExcelTimestamp = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}${month}${day}_${hours}${minutes}`;
};

const buildEmptyScoreStats = () => ({
  totalCount: 0,
  averageScore: null
});

const buildEmptyPagination = (pageSize = DEFAULT_SCORE_PAGE_SIZE) => ({
  page: 1,
  pageSize,
  totalItems: 0,
  totalPages: 1,
  hasPrevPage: false,
  hasNextPage: false
});

const buildVisiblePageNumbers = (currentPage, totalPages) => {
  const safeTotalPages = Math.max(1, Number(totalPages) || 1);
  const safeCurrentPage = Math.min(safeTotalPages, Math.max(1, Number(currentPage) || 1));
  const start = Math.max(1, safeCurrentPage - 2);
  const end = Math.min(safeTotalPages, start + 4);
  const adjustedStart = Math.max(1, end - 4);
  return Array.from({ length: end - adjustedStart + 1 }, (_, index) => adjustedStart + index);
};

const getContactFieldMeta = (batchType) => {
  if (
    batchType === BATCH_TYPES.RETIRED
    || batchType === BATCH_TYPES.ADMISSION_RETIRED
  ) {
    return {
      label: '微信号',
      shortLabel: '微信号',
      placeholder: '请输入微信号'
    };
  }

  if (batchType === BATCH_TYPES.ADMISSION) {
    return {
      label: 'QQ号',
      shortLabel: 'QQ号',
      placeholder: '请输入QQ号'
    };
  }

  return {
    label: 'QQ联系方式',
    shortLabel: 'QQ号',
    placeholder: '请输入QQ号'
  };
};

const isAdmissionBatchType = (batchType) => (
  batchType === BATCH_TYPES.ADMISSION
  || batchType === BATCH_TYPES.ADMISSION_RETIRED
);

const parseScore = (value) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const hasScoreValue = (value) => (
  value !== undefined
  && value !== null
  && String(value).trim() !== ''
);

const parseRequiredScore = (value) => {
  if (!hasScoreValue(value)) {
    return null;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const formatScoreDisplay = (value) => {
  const numeric = parseScore(value);
  return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(1);
};

const formatOptionalScoreDisplay = (value) => (
  hasScoreValue(value) ? formatScoreDisplay(value) : '-'
);

const getScoreTotal = (score, batchType) => {
  const persistedTotal = Number.parseFloat(score?.totalScore);
  if (Number.isFinite(persistedTotal)) {
    return persistedTotal;
  }

  if (batchType === BATCH_TYPES.RETIRED) {
    return parseScore(score?.compTheory);
  }

  if (isAdmissionBatchType(batchType)) {
    return parseScore(score?.admissionScore);
  }

  return (
    parseScore(score?.highMath)
    + parseScore(score?.english)
    + parseScore(score?.compTheory)
    + parseScore(score?.compPractical)
  );
};

const getAdminTotalScoreError = (batchType, totalScore) => {
  const meta = ADMIN_TOTAL_META[batchType] || ADMIN_TOTAL_META[BATCH_TYPES.NORMAL];

  if (!Number.isFinite(totalScore)) {
    return `${meta.label}为必填项`;
  }

  if (totalScore < 0) {
    return `${meta.label}不能小于0`;
  }

  if (Number.isFinite(meta.max) && totalScore > meta.max) {
    return `${meta.label}不能大于${meta.max}分，请重新输入`;
  }

  return null;
};

const getApiErrorMessage = (error, fallback = '操作失败') => {
  const responseData = error?.response?.data;
  const statusCode = Number(error?.response?.status || 0);

  if (
    statusCode === 413
    || (typeof responseData === 'string' && /413\s+Request Entity Too Large/i.test(responseData))
  ) {
    return '上传图片过大，请压缩到 10MB 以内后重试';
  }

  if (typeof responseData === 'string' && responseData.trim()) {
    return responseData.trim();
  }

  if (typeof responseData?.error === 'string' && responseData.error.trim()) {
    return responseData.error.trim();
  }

  if (typeof responseData?.message === 'string' && responseData.message.trim()) {
    return responseData.message.trim();
  }

  if (error?.message === 'Network Error') {
    return '网络异常，请稍后重试';
  }

  return fallback;
};

const createAdminEditDraft = (score) => ({
  highMath: score?.highMath ?? '',
  english: score?.english ?? '',
  compTheory: score?.compTheory ?? '',
  compPractical: score?.compPractical ?? '',
  totalScore: getScoreTotal(score, score?.batchType),
  isRecommended: score?.isRecommended ? 'yes' : 'no',
  firstChoice: String(score?.firstChoice || ''),
  admissionScore: score?.admissionScore ?? '',
  admissionSchool: String(score?.admissionSchool || ''),
  admissionMajor: String(score?.admissionMajor || '')
});

const requiresNormalFirstChoice = (totalScore) => totalScore >= NORMAL_FIRST_CHOICE_THRESHOLD;

function App() {
  const isAdminPage = normalizePathname(window.location.pathname) === ADMIN_ENTRY_PATH;
  const [selectedBatch, setSelectedBatch] = useState(() => {
    try {
      return getStoredBatchType() || (isAdminPage ? BATCH_TYPES.NORMAL : null);
    } catch (error) {
      return isAdminPage ? BATCH_TYPES.NORMAL : null;
    }
  });

  const [scores, setScores] = useState([]);
  const [scoreStats, setScoreStats] = useState(() => buildEmptyScoreStats());
  const [pagination, setPagination] = useState(() => buildEmptyPagination());
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_SCORE_PAGE_SIZE);
  const [myId, setMyId] = useState(null);
  const [myName, setMyName] = useState('');
  const [myRecord, setMyRecord] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [showConsultModal, setShowConsultModal] = useState(false);

  const [isAdmin, setIsAdmin] = useState(false);
  const [isRefreshingAdmin, setIsRefreshingAdmin] = useState(false);
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [admissionOptions, setAdmissionOptions] = useState([]);
  const [schoolSearchQuery, setSchoolSearchQuery] = useState('');
  const [isSchoolDropdownOpen, setIsSchoolDropdownOpen] = useState(false);
  const [firstChoiceSearchQuery, setFirstChoiceSearchQuery] = useState('');
  const [isFirstChoiceDropdownOpen, setIsFirstChoiceDropdownOpen] = useState(false);
  const [isCustomInstitution, setIsCustomInstitution] = useState(false);

  const [formData, setFormData] = useState(() => buildInitialFormData());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [adminEditingScoreId, setAdminEditingScoreId] = useState(null);
  const [adminEditDraft, setAdminEditDraft] = useState(null);
  const [isSavingAdminEdit, setIsSavingAdminEdit] = useState(false);
  const [adminSearchKeyword, setAdminSearchKeyword] = useState('');
  const [adminSearchStatus, setAdminSearchStatus] = useState('');
  const [isAdminSearching, setIsAdminSearching] = useState(false);
  const [adminSearchTargetId, setAdminSearchTargetId] = useState(null);
  const [adminAddDraft, setAdminAddDraft] = useState(() => createAdminAddDraft());
  const [isAddingAdminScore, setIsAddingAdminScore] = useState(false);
  const [scoreProtectionEnabled, setScoreProtectionEnabled] = useState(false);
  const [isLoadingScoreProtection, setIsLoadingScoreProtection] = useState(false);
  const [isSavingScoreProtection, setIsSavingScoreProtection] = useState(false);
  const [scoreProtectionStatus, setScoreProtectionStatus] = useState('');
  const [isAdmissionStatsOpen, setIsAdmissionStatsOpen] = useState(false);
  const [admissionStatsBatch, setAdmissionStatsBatch] = useState(BATCH_TYPES.ADMISSION);
  const [admissionRangeStats, setAdmissionRangeStats] = useState(null);
  const [isLoadingAdmissionStats, setIsLoadingAdmissionStats] = useState(false);
  const [admissionStatsStatus, setAdmissionStatsStatus] = useState('');
  const latestHydrationRequestRef = useRef(0);
  const socketRefreshTimerRef = useRef(null);

  const isNormalBatch = selectedBatch === BATCH_TYPES.NORMAL;
  const isRetiredBatch = selectedBatch === BATCH_TYPES.RETIRED;
  const isNormalAdmissionBatch = selectedBatch === BATCH_TYPES.ADMISSION;
  const isRetiredAdmissionBatch = selectedBatch === BATCH_TYPES.ADMISSION_RETIRED;
  const isAdmissionBatch = isAdmissionBatchType(selectedBatch);
  const usesWechatContact = isRetiredBatch || isRetiredAdmissionBatch;
  const requiresContact = true;
  const shouldShowRankingColumn = !isAdmissionBatch;
  const currentBatchMeta = selectedBatch ? BATCH_META[selectedBatch] : null;
  const contactFieldMeta = getContactFieldMeta(selectedBatch);
  const isAdminView = isAdminPage && isAdmin;
  const adminTotalMeta = ADMIN_TOTAL_META[selectedBatch] || ADMIN_TOTAL_META[BATCH_TYPES.NORMAL];
  const normalBatchTotalScore = isNormalBatch
    ? (
        parseScore(formData.highMath)
        + parseScore(formData.english)
        + parseScore(formData.compTheory)
        + parseScore(formData.compPractical)
      )
    : 0;
  const shouldChooseNormalFirstChoice = isNormalBatch && requiresNormalFirstChoice(normalBatchTotalScore);
  const admissionStatsBatchLabel = admissionStatsBatch === BATCH_TYPES.ADMISSION_RETIRED
    ? '退役批次'
    : '普通批次';
  const admissionStatsSchools = Array.isArray(admissionRangeStats?.schools)
    ? admissionRangeStats.schools
    : [];
  const admissionStatsTotals = admissionRangeStats?.totals || {
    totalCount: 0,
    eligibleCount: 0,
    excludedRecommendedCount: 0
  };
  const admissionStatsRows = useMemo(
    () => admissionStatsSchools.flatMap((school) => (
      (Array.isArray(school.majors) ? school.majors : []).map((major) => ({
        school: school.school,
        ...major
      }))
    )),
    [admissionStatsSchools]
  );
  const visiblePageNumbers = useMemo(
    () => buildVisiblePageNumbers(pagination.page, pagination.totalPages),
    [pagination.page, pagination.totalPages]
  );
  const hasSubmittedCurrentBatch = Boolean(myRecord);

  useEffect(() => {
    if (!selectedBatch) {
      setAdmissionOptions([]);
      return undefined;
    }

    let cancelled = false;

    const fetchAdmissionOptions = async () => {
      try {
        const res = await api.get('/admission-options', {
          params: {
            batchType: selectedBatch
          }
        });
        if (!cancelled) {
          setAdmissionOptions(Array.isArray(res.data?.schools) ? res.data.schools : []);
        }
      } catch (error) {
        console.error('Failed to fetch admission options', error);
      }
    };

    fetchAdmissionOptions();

    return () => {
      cancelled = true;
    };
  }, [selectedBatch]);

  useEffect(() => {
    if (!selectedBatch) {
      setScores([]);
      setScoreStats(buildEmptyScoreStats());
      setPagination(buildEmptyPagination());
      setCurrentPage(1);
      setPageSize(DEFAULT_SCORE_PAGE_SIZE);
      setMyId(null);
      setMyName('');
      setMyRecord(null);
      setIsEditing(false);
      setIsCustomInstitution(false);
      setSchoolSearchQuery('');
      setIsSchoolDropdownOpen(false);
      setFirstChoiceSearchQuery('');
      setIsFirstChoiceDropdownOpen(false);
      setAdminEditingScoreId(null);
      setAdminEditDraft(null);
      setAdminSearchKeyword('');
      setAdminSearchStatus('');
      setIsAdminSearching(false);
      setAdminSearchTargetId(null);
      setAdminAddDraft(createAdminAddDraft());
      setIsAddingAdminScore(false);
      setScoreProtectionStatus('');
      latestHydrationRequestRef.current = 0;
      return;
    }

    localStorage.setItem(BATCH_STORAGE_KEY, selectedBatch);
    const storedUser = getStoredBatchUser(selectedBatch);
    setScores([]);
    setScoreStats(buildEmptyScoreStats());
    setPagination(buildEmptyPagination());
    setCurrentPage(1);
    setPageSize(DEFAULT_SCORE_PAGE_SIZE);
    setMyId(storedUser.id);
    setMyName(storedUser.name);
    setMyRecord(null);
    setIsEditing(false);
    setIsCustomInstitution(false);
    setSchoolSearchQuery('');
    setIsSchoolDropdownOpen(false);
    setFirstChoiceSearchQuery('');
    setIsFirstChoiceDropdownOpen(false);
    setAdminEditingScoreId(null);
    setAdminEditDraft(null);
    setAdminSearchKeyword('');
    setAdminSearchStatus('');
    setIsAdminSearching(false);
    setAdminSearchTargetId(null);
    setAdminAddDraft(createAdminAddDraft());
    setIsAddingAdminScore(false);
    setScoreProtectionStatus('');
    latestHydrationRequestRef.current = 0;
    setFormData(buildInitialFormData({
      name: storedUser.name
    }));
  }, [selectedBatch]);

  useEffect(() => {
    if (!isNormalBatch || shouldChooseNormalFirstChoice) {
      return;
    }

    setFormData((prev) => (
      prev.firstChoice
        ? { ...prev, firstChoice: '' }
        : prev
    ));
  }, [isNormalBatch, shouldChooseNormalFirstChoice]);

  useEffect(() => {
    if (adminEditingScoreId && !scores.some((score) => score.id === adminEditingScoreId)) {
      setAdminEditingScoreId(null);
      setAdminEditDraft(null);
    }
  }, [adminEditingScoreId, scores]);

  useEffect(() => {
    if (!adminSearchTargetId) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      const targetRow = document.getElementById(`score-row-${adminSearchTargetId}`);
      targetRow?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'nearest'
      });
    }, 80);

    return () => window.clearTimeout(timer);
  }, [adminSearchTargetId, scores]);

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

  const fetchScores = useCallback(async ({
    page = currentPage,
    pageSize: requestedPageSize = pageSize,
    includeAll = false,
    syncState = true
  } = {}) => {
    if (!selectedBatch) return null;

    const requestId = syncState ? latestHydrationRequestRef.current + 1 : null;
    if (syncState) {
      latestHydrationRequestRef.current = requestId;
    }

    try {
      const res = await api.get('/scores', {
        params: {
          myId,
          batchType: selectedBatch,
          ...(isAdminView ? { adminView: 1 } : {}),
          ...(includeAll ? { all: 1 } : { page, pageSize: requestedPageSize })
        }
      });

      const payload = {
        items: Array.isArray(res.data?.items) ? res.data.items : [],
        myRecord: res.data?.myRecord || null,
        stats: {
          totalCount: Number(res.data?.stats?.totalCount || 0),
          averageScore: res.data?.stats?.averageScore ?? null
        },
        pagination: {
          ...buildEmptyPagination(requestedPageSize),
          ...(res.data?.pagination || {})
        }
      };

      if (syncState && latestHydrationRequestRef.current === requestId) {
        setScores(payload.items);
        setMyRecord(payload.myRecord);
        setScoreStats(payload.stats);
        setPagination(payload.pagination);

        if (!includeAll && payload.pagination.page !== currentPage) {
          setCurrentPage(payload.pagination.page);
        }
      }

      return payload;
    } catch (err) {
      console.error('Failed to fetch scores', err);
      return null;
    }
  }, [currentPage, isAdminView, myId, pageSize, selectedBatch]);

  const fetchAdmissionRangeStats = useCallback(async ({ showLoading = false } = {}) => {
    if (!isAdminView) {
      return null;
    }

    try {
      if (showLoading) {
        setIsLoadingAdmissionStats(true);
      }
      const res = await api.get('/admin/admission-score-stats', {
        params: {
          batchType: admissionStatsBatch
        }
      });
      setAdmissionRangeStats(res.data || null);
      setAdmissionStatsStatus('');
      return res.data || null;
    } catch (error) {
      if (error.response?.status === 401 || error.response?.status === 403) {
        setAdmissionStatsStatus('管理员登录已过期，请重新登录');
        setIsAdmin(false);
        setShowAdminLogin(true);
        refreshAdminSession();
        return null;
      }
      console.error('Failed to fetch admission score stats', error);
      setAdmissionStatsStatus(getApiErrorMessage(error, '统计数据获取失败，请稍后重试'));
      return null;
    } finally {
      if (showLoading) {
        setIsLoadingAdmissionStats(false);
      }
    }
  }, [admissionStatsBatch, isAdminView, refreshAdminSession]);

  useEffect(() => {
    if (!isAdmissionStatsOpen || !isAdminView) {
      return undefined;
    }

    fetchAdmissionRangeStats({ showLoading: true });
    const timer = window.setInterval(() => {
      fetchAdmissionRangeStats();
    }, AUTO_REFRESH_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [fetchAdmissionRangeStats, isAdmissionStatsOpen, isAdminView]);

  useEffect(() => {
    if (!selectedBatch) return undefined;

    const socket = io(SOCKET_URL, {
      path: SOCKET_PATH
    });

    socket.on('update_scores', () => {
      window.clearTimeout(socketRefreshTimerRef.current);
      socketRefreshTimerRef.current = window.setTimeout(() => {
        fetchScores();
        if (isAdmissionStatsOpen && isAdminView) {
          fetchAdmissionRangeStats();
        }
      }, SOCKET_REFRESH_DEBOUNCE_MS);
    });

    return () => {
      window.clearTimeout(socketRefreshTimerRef.current);
      socket.disconnect();
    };
  }, [fetchAdmissionRangeStats, fetchScores, isAdmissionStatsOpen, isAdminView, selectedBatch]);

  useEffect(() => {
    if (!selectedBatch) return;
    fetchScores();
  }, [fetchScores, selectedBatch]);

  useEffect(() => {
    if (!selectedBatch) return undefined;

    const timer = window.setInterval(() => {
      fetchScores();
    }, AUTO_REFRESH_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [fetchScores, selectedBatch]);

  const admissionSchoolMap = useMemo(
    () => new Map(admissionOptions.map((item) => [item.school, item.majors])),
    [admissionOptions]
  );

  const availableMajors = useMemo(
    () => admissionSchoolMap.get(formData.admissionSchool) || [],
    [admissionSchoolMap, formData.admissionSchool]
  );

  const filteredSchoolOptions = useMemo(() => {
    const keyword = String(schoolSearchQuery || '').trim();
    const source = keyword
      ? admissionOptions.filter((item) => item.school.includes(keyword))
      : admissionOptions;
    return source.slice(0, 20);
  }, [admissionOptions, schoolSearchQuery]);

  const retiredFirstChoiceSchoolOptions = useMemo(
    () => admissionOptions.map((item) => item.school),
    [admissionOptions]
  );

  const retiredFirstChoiceSchoolSet = useMemo(
    () => new Set(retiredFirstChoiceSchoolOptions),
    [retiredFirstChoiceSchoolOptions]
  );

  const filteredFirstChoiceSchoolOptions = useMemo(() => {
    const keyword = String(firstChoiceSearchQuery || '').trim();
    const source = keyword
      ? retiredFirstChoiceSchoolOptions.filter((school) => school.includes(keyword))
      : retiredFirstChoiceSchoolOptions;
    return source.slice(0, 20);
  }, [firstChoiceSearchQuery, retiredFirstChoiceSchoolOptions]);

  const validateScoreLimits = () => {
    if (isAdmissionBatch) {
      return true;
    }

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

  const handleSchoolSearchChange = (value) => {
    setSchoolSearchQuery(value);
    setIsSchoolDropdownOpen(true);
    setFormData((prev) => {
      if (value === prev.admissionSchool) {
        return prev;
      }

      return {
        ...prev,
        admissionSchool: '',
        admissionMajor: ''
      };
    });
  };

  const handleSchoolSelect = (school) => {
    const majors = admissionSchoolMap.get(school) || [];
    setSchoolSearchQuery(school);
    setIsSchoolDropdownOpen(false);
    setFormData((prev) => ({
      ...prev,
      admissionSchool: school,
      admissionMajor: majors.length === 1 ? majors[0] : ''
    }));
  };

  const handleFirstChoiceSearchChange = (value) => {
    setFirstChoiceSearchQuery(value);
    setIsFirstChoiceDropdownOpen(true);
    setFormData((prev) => {
      if (value === prev.firstChoice) {
        return prev;
      }

      return {
        ...prev,
        firstChoice: ''
      };
    });
  };

  const handleFirstChoiceSchoolSelect = (school) => {
    setFirstChoiceSearchQuery(school);
    setIsFirstChoiceDropdownOpen(false);
    setFormData((prev) => ({
      ...prev,
      firstChoice: school
    }));
  };

  const handleInstitutionSelectChange = (value) => {
    if (value === CUSTOM_INSTITUTION_VALUE) {
      setIsCustomInstitution(true);
      setFormData((prev) => ({
        ...prev,
        institution: prev.institution !== DEFAULT_INSTITUTION ? prev.institution : ''
      }));
      return;
    }

    setIsCustomInstitution(false);
    setFormData((prev) => ({
      ...prev,
      institution: DEFAULT_INSTITUTION
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!selectedBatch) {
      alert('请先选择批次');
      return;
    }

    if (hasSubmittedCurrentBatch) {
      alert('你已完成登记，如需修改请联系管理员');
      setIsEditing(false);
      return;
    }

    try {
      const normalizedName = String(formData.name || '').trim();
      const normalizedInstitution = isAdmissionBatch || isRetiredBatch
        ? ''
        : (
            isCustomInstitution
              ? String(formData.institution || '').trim()
              : DEFAULT_INSTITUTION
          );

      if (!normalizedName) {
        alert('请填写姓名');
        return;
      }

      if (!isAdmissionBatch && !isRetiredBatch && !normalizedInstitution) {
        alert('请输入机构名称');
        return;
      }

      if (requiresContact && !String(formData.qq || '').trim()) {
        alert(`请填写${contactFieldMeta.label}`);
        return;
      }

      if (isNormalAdmissionBatch && !['yes', 'no'].includes(String(formData.isRecommended || ''))) {
        alert('请选择是否为保送生');
        return;
      }

      if (!validateScoreLimits()) {
        return;
      }

      if (isNormalBatch && shouldChooseNormalFirstChoice && !String(formData.firstChoice || '').trim()) {
        alert(`总分达到 ${NORMAL_FIRST_CHOICE_THRESHOLD} 分及以上时，请选择一志愿`);
        return;
      }

      if (isRetiredBatch) {
        const normalizedFirstChoice = String(formData.firstChoice || '').trim();
        if (!normalizedFirstChoice || !retiredFirstChoiceSchoolSet.has(normalizedFirstChoice)) {
          alert('请从下拉候选中选择一志愿院校');
          return;
        }
      }

      const payload = {
        ...formData,
        batchType: selectedBatch,
        name: normalizedName,
        isRecommended: isNormalAdmissionBatch ? formData.isRecommended === 'yes' : false,
        volunteers: []
      };

      payload.qq = usesWechatContact
        ? String(formData.qq || '').trim()
        : String(formData.qq || '').trim().replace(/\D/g, '');
      payload.firstChoice = '';
      if (isNormalBatch && shouldChooseNormalFirstChoice) {
        payload.firstChoice = String(formData.firstChoice || '').trim();
      }
      if (isRetiredBatch) {
        payload.firstChoice = String(formData.firstChoice || '').trim();
      }

      if (isAdmissionBatch) {
        const normalizedSchool = String(formData.admissionSchool || '').trim();
        const normalizedMajor = String(formData.admissionMajor || '').trim();
        const schoolMajors = admissionSchoolMap.get(normalizedSchool);
        const normalizedScore = String(formData.admissionScore || '').trim();
        const parsedAdmissionScore = Number.parseFloat(normalizedScore);

        if (!normalizedSchool || !schoolMajors) {
          alert('请从下拉候选中选择录取院校');
          return;
        }

        if (!normalizedMajor || !schoolMajors.includes(normalizedMajor)) {
          alert('请选择该录取院校对应的录取专业');
          return;
        }

        if (!normalizedScore || !Number.isFinite(parsedAdmissionScore) || parsedAdmissionScore <= 0) {
          alert('请填写有效的录取分数');
          return;
        }

        payload.institution = '';
        payload.highMath = 0;
        payload.english = 0;
        payload.compTheory = 0;
        payload.compPractical = 0;
        payload.admissionScore = parsedAdmissionScore;
        payload.admissionSchool = normalizedSchool;
        payload.admissionMajor = normalizedMajor;
      } else {
        payload.institution = isRetiredBatch ? '' : normalizedInstitution;
        payload.admissionScore = 0;
        payload.admissionSchool = '';
        payload.admissionMajor = '';
      }

      if (isRetiredBatch) {
        payload.highMath = 0;
        payload.english = 0;
        payload.compPractical = 0;
      }

      const requestPayload = payload;
      setIsSubmitting(true);
      const submitToken = await requestScoreSubmitToken();

      const res = await api.post('/scores', requestPayload, {
        headers: {
          'X-Score-Submit-Token': submitToken
        }
      });
      const { id } = res.data.data;
      const nextUser = {
        id,
        name: normalizedName
      };

      persistBatchUser(selectedBatch, nextUser);
      setMyId(nextUser.id);
      setMyName(nextUser.name);

      alert('登记成功！');
      setIsEditing(false);
      setIsSchoolDropdownOpen(false);
      setIsFirstChoiceDropdownOpen(false);
      fetchScores();
    } catch (err) {
      alert(getApiErrorMessage(err, '提交失败，请稍后重试'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditClick = (record) => {
    if (!selectedBatch) return;

    if (!record) {
      setSchoolSearchQuery('');
      setFirstChoiceSearchQuery('');
      setIsCustomInstitution(false);
      setFormData(buildInitialFormData({
        name: myName || ''
      }));
      setIsEditing(true);
      return;
    }

    const institution = String(record.institution || '').trim();
    const nextInstitution = institution || DEFAULT_INSTITUTION;
    setIsCustomInstitution(nextInstitution !== DEFAULT_INSTITUTION);
    setSchoolSearchQuery(record.admissionSchool || '');
    setFirstChoiceSearchQuery(record.firstChoice || '');
    setFormData(buildInitialFormData({
      name: record.name,
      institution: nextInstitution,
      qq: record.qq || '',
      highMath: record.highMath,
      english: record.english,
      compTheory: record.compTheory,
      compPractical: record.compPractical,
      firstChoice: record.firstChoice,
      admissionScore: record.admissionScore,
      admissionSchool: record.admissionSchool,
      admissionMajor: record.admissionMajor,
      volunteers: []
    }));
    setIsEditing(true);
  };

  const closeAdminLoginModal = () => {
    setShowAdminLogin(false);
    setAdminPassword('');
  };

  const handleAdminLogin = async (e) => {
    e.preventDefault();
    try {
      const password = String(adminPassword || '');

      if (!password) {
        alert('请输入管理员密码');
        return;
      }

      const res = await api.post('/admin/login', {
        method: 'password',
        password
      });

      if (res.data?.success) {
        const authenticated = await refreshAdminSession();
        if (!authenticated) {
          alert('管理员登录状态未生效，请刷新页面后重试');
          return;
        }
        closeAdminLoginModal();
        await refreshScoreProtection();
        await fetchScores();
        alert('管理员登录成功');
      }
    } catch (err) {
      alert(getApiErrorMessage(err, '管理员登录失败，请重试'));
    }
  };

  const handleAdminLogout = async () => {
    try {
      await api.post('/admin/logout');
    } catch (error) {
      // Continue local state reset even if request fails
    }
    setIsAdmin(false);
    setScoreProtectionEnabled(false);
    setScoreProtectionStatus('');
    fetchScores();
    refreshAdminSession();
  };

  const refreshScoreProtection = useCallback(async () => {
    if (!isAdminPage) {
      return null;
    }

    try {
      setIsLoadingScoreProtection(true);
      const res = await api.get('/admin/score-protection');
      const enabled = Boolean(res.data?.enabled);
      setScoreProtectionEnabled(enabled);
      setScoreProtectionStatus(enabled ? '登记防护已开启' : '登记防护已关闭');
      return enabled;
    } catch (error) {
      if (error.response?.status === 401 || error.response?.status === 403) {
        setIsAdmin(false);
      }
      setScoreProtectionStatus('登记防护状态读取失败');
      return null;
    } finally {
      setIsLoadingScoreProtection(false);
    }
  }, [isAdminPage]);

  useEffect(() => {
    if (!isAdminView) {
      return;
    }

    refreshScoreProtection();
  }, [isAdminView, refreshScoreProtection]);

  const handleToggleScoreProtection = async () => {
    if (!isAdminView) {
      alert('请先登录管理员模式');
      return;
    }

    const nextEnabled = !scoreProtectionEnabled;
    const confirmMessage = nextEnabled
      ? '开启后将启用提交令牌、来源校验、IP 黑名单、提交频率和同 IP 多姓名限制。确认开启吗？'
      : '关闭后学生端登记不再使用 IP/填写防护限制，只保留页面 5 秒自动刷新。确认关闭吗？';

    if (!window.confirm(confirmMessage)) {
      return;
    }

    try {
      setIsSavingScoreProtection(true);
      const res = await api.put('/admin/score-protection', {
        enabled: nextEnabled
      });
      const enabled = Boolean(res.data?.enabled);
      setScoreProtectionEnabled(enabled);
      setScoreProtectionStatus(enabled ? '登记防护已开启' : '登记防护已关闭');
    } catch (error) {
      if (error.response?.status === 401 || error.response?.status === 403) {
        alert('管理员登录已过期，请重新登录');
        setIsAdmin(false);
        setShowAdminLogin(true);
        refreshAdminSession();
        return;
      }
      alert(getApiErrorMessage(error, '登记防护设置保存失败，请稍后重试'));
    } finally {
      setIsSavingScoreProtection(false);
    }
  };

  const handleExportScores = async () => {
    if (!isAdminView) {
      alert('请先登录管理员模式');
      return;
    }

    if (!selectedBatch) {
      alert('请先选择批次');
      return;
    }

    const exportPayload = await fetchScores({
      includeAll: true,
      syncState: false
    });
    const exportScores = Array.isArray(exportPayload?.items) ? exportPayload.items : [];

    if (exportScores.length === 0) {
      alert('当前没有可导出的登记数据');
      return;
    }

    let rows;
    let columns;
    let sheetName;
    let fileName;

    if (isAdmissionBatch) {
      rows = exportScores.map((score) => ({
        姓名: score.name || '',
        [contactFieldMeta.shortLabel]: score.qq || '',
        ...(isNormalAdmissionBatch ? { 是否保送生: score.isRecommended ? '是' : '否' } : {}),
        录取分数: parseScore(score.admissionScore),
        录取院校: score.admissionSchool || '',
        录取专业: score.admissionMajor || ''
      }));
      columns = isNormalAdmissionBatch
        ? [
            { wch: 14 },
            { wch: 18 },
            { wch: 12 },
            { wch: 12 },
            { wch: 24 },
            { wch: 24 }
          ]
        : [
            { wch: 14 },
            { wch: 18 },
            { wch: 12 },
            { wch: 24 },
            { wch: 24 }
          ];
      sheetName = `${currentBatchMeta.label}登记`;
      fileName = `录取结果登记_${formatExcelTimestamp()}.xlsx`;
    } else {
      rows = exportScores.map((score) => {
        const totalScore = getScoreTotal(score, selectedBatch);

        return {
          姓名: score.name || '',
          ...(isRetiredBatch ? {} : { 机构: score.institution || '' }),
          [contactFieldMeta.shortLabel]: score.qq || '',
          ...(isRetiredBatch ? {} : { 高数成绩: hasScoreValue(score.highMath) ? parseScore(score.highMath) : '' }),
          ...(isRetiredBatch ? {} : { 外语成绩: hasScoreValue(score.english) ? parseScore(score.english) : '' }),
          ...(isRetiredBatch
            ? { 分数: totalScore }
            : { 理论成绩: hasScoreValue(score.compTheory) ? parseScore(score.compTheory) : '' }),
          ...(isRetiredBatch ? {} : { 实操成绩: hasScoreValue(score.compPractical) ? parseScore(score.compPractical) : '' }),
          ...(isRetiredBatch ? {} : { 总分: totalScore }),
          一志愿: score.firstChoice || ''
        };
      });
      columns = isRetiredBatch
        ? [
            { wch: 14 },
            { wch: 20 },
            { wch: 12 },
            { wch: 24 }
          ]
        : [
            { wch: 14 },
            { wch: 14 },
            { wch: 18 },
            { wch: 12 },
            { wch: 12 },
            { wch: 12 },
            { wch: 12 },
            { wch: 10 },
            { wch: 28 }
          ];
      sheetName = `${currentBatchMeta.label}排行榜`;
      fileName = `分数线排行榜_${currentBatchMeta.label}_${formatExcelTimestamp()}.xlsx`;
    }

    const XLSX = await import('xlsx');
    const worksheet = XLSX.utils.json_to_sheet(rows);
    worksheet['!cols'] = columns;

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    XLSX.writeFile(workbook, fileName);
  };

  const handleAdminAddDraftChange = (field, value) => {
    setAdminAddDraft((prev) => ({
      ...prev,
      [field]: field === 'qq' && !usesWechatContact
        ? String(value || '').replace(/\D/g, '')
        : value
    }));
  };

  const handleAdminAddScore = async (event) => {
    event.preventDefault();

    if (!isAdminView) {
      alert('请先登录管理员模式');
      return;
    }

    if (!selectedBatch) {
      alert('请先选择批次');
      return;
    }

    const normalizedName = String(adminAddDraft.name || '').trim();
    const totalScore = parseRequiredScore(adminAddDraft.totalScore);
    const totalScoreError = getAdminTotalScoreError(selectedBatch, totalScore);

    if (!normalizedName) {
      alert('请填写姓名');
      return;
    }

    if (totalScoreError) {
      alert(totalScoreError);
      return;
    }

    const payload = {
      ...adminAddDraft,
      batchType: selectedBatch,
      name: normalizedName,
      totalScore,
      qq: usesWechatContact
        ? String(adminAddDraft.qq || '').trim()
        : String(adminAddDraft.qq || '').trim().replace(/\D/g, ''),
      institution: isNormalBatch ? String(adminAddDraft.institution || '').trim() : '',
      isRecommended: isNormalAdmissionBatch ? adminAddDraft.isRecommended === 'yes' : false
    };

    try {
      setIsAddingAdminScore(true);
      await api.post('/admin/scores', payload);
      alert('添加成功');
      setAdminAddDraft(createAdminAddDraft());
      setCurrentPage(1);
      await fetchScores({ page: 1 });
    } catch (err) {
      if (err.response?.status === 401 || err.response?.status === 403) {
        alert('管理员登录已过期，请重新登录');
        setIsAdmin(false);
        setShowAdminLogin(true);
        refreshAdminSession();
        return;
      }
      alert(getApiErrorMessage(err, '添加失败，请稍后重试'));
    } finally {
      setIsAddingAdminScore(false);
    }
  };

  const handleAdminSearch = async (event) => {
    event.preventDefault();

    if (!isAdminView) {
      alert('请先登录管理员模式');
      return;
    }

    const keyword = String(adminSearchKeyword || '').trim();
    if (!keyword) {
      setAdminSearchStatus('');
      setAdminSearchTargetId(null);
      alert('请输入要搜索的学生姓名');
      return;
    }

    try {
      setIsAdminSearching(true);
      setAdminSearchStatus('正在搜索...');
      setAdminSearchTargetId(null);

      const searchPayload = await fetchScores({
        includeAll: true,
        syncState: false
      });
      const allScores = Array.isArray(searchPayload?.items) ? searchPayload.items : [];
      const normalizedKeyword = keyword.toLowerCase();
      const matchedIndex = allScores.findIndex((score) => (
        String(score.name || '').trim().toLowerCase().includes(normalizedKeyword)
      ));

      if (matchedIndex === -1) {
        setAdminSearchStatus(`未找到姓名包含“${keyword}”的记录`);
        alert(`未找到姓名包含“${keyword}”的记录`);
        return;
      }

      const matchedScore = allScores[matchedIndex];
      const targetPage = Math.floor(matchedIndex / pageSize) + 1;
      setAdminSearchTargetId(matchedScore.id);
      setAdminSearchStatus(`已定位：${matchedScore.name}（第 ${targetPage} 页，第 ${matchedIndex + 1} 条）`);
      setCurrentPage(targetPage);
      await fetchScores({
        page: targetPage,
        pageSize
      });
    } catch (error) {
      console.error('Failed to search admin score', error);
      setAdminSearchStatus('搜索失败，请稍后重试');
      alert('搜索失败，请稍后重试');
    } finally {
      setIsAdminSearching(false);
    }
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
      alert(`删除失败：${getApiErrorMessage(err, '请稍后重试')}`);
    }
  };

  const handleAdminEditFieldChange = (field, value) => {
    setAdminEditDraft((prev) => {
      if (!prev) {
        return prev;
      }

      return {
        ...prev,
        [field]: value
      };
    });
  };

  const handleAdminStartEdit = (score) => {
    setAdminEditingScoreId(score.id);
    setAdminEditDraft(createAdminEditDraft(score));
  };

  const handleAdminCancelEdit = () => {
    setAdminEditingScoreId(null);
    setAdminEditDraft(null);
  };

  const handleAdminSaveEdit = async (score) => {
    if (!adminEditDraft || adminEditingScoreId !== score.id) {
      return;
    }

    const limits = isRetiredBatch
      ? []
      : [
          { key: 'highMath', label: '高数成绩', max: 150 },
          { key: 'english', label: '外语成绩', max: 120 },
          { key: 'compTheory', label: '理论成绩', max: 150 },
          { key: 'compPractical', label: '实操成绩', max: 80 }
        ];

    for (const item of limits) {
      const nextScore = parseScore(adminEditDraft[item.key]);
      if (nextScore > item.max) {
        alert(`${item.label}不能大于${item.max}分，请重新输入`);
        return;
      }
    }

    const nextTotal = parseRequiredScore(adminEditDraft.totalScore);
    const totalScoreError = getAdminTotalScoreError(selectedBatch, nextTotal);
    const nextFirstChoice = String(adminEditDraft.firstChoice || '').trim();

    if (totalScoreError) {
      alert(totalScoreError);
      return;
    }

    const changedFields = [];
    const pushChange = (label, before, after) => {
      if (String(before) !== String(after)) {
        changedFields.push(`${label}：${before} -> ${after}`);
      }
    };

    if (isRetiredBatch) {
      pushChange('分数', formatScoreDisplay(getScoreTotal(score, selectedBatch)), formatScoreDisplay(nextTotal));
    } else {
      pushChange('高数成绩', formatOptionalScoreDisplay(score.highMath), formatOptionalScoreDisplay(adminEditDraft.highMath));
      pushChange('外语成绩', formatOptionalScoreDisplay(score.english), formatOptionalScoreDisplay(adminEditDraft.english));
      pushChange('理论成绩', formatOptionalScoreDisplay(score.compTheory), formatOptionalScoreDisplay(adminEditDraft.compTheory));
      pushChange('实操成绩', formatOptionalScoreDisplay(score.compPractical), formatOptionalScoreDisplay(adminEditDraft.compPractical));
      pushChange(
        '总分',
        formatScoreDisplay(getScoreTotal(score, selectedBatch)),
        formatScoreDisplay(nextTotal)
      );
      pushChange('一志愿', score.firstChoice || '未填写', nextFirstChoice || '未填写');
    }

    if (changedFields.length === 0) {
      alert('当前没有可保存的修改');
      return;
    }

    const confirmMessage = [
      `确认保存 ${score.name} 的成绩修改吗？`,
      '',
      ...changedFields
    ].join('\n');

    if (!window.confirm(confirmMessage)) {
      return;
    }

    try {
      setIsSavingAdminEdit(true);

      const payload = isRetiredBatch
        ? {
            totalScore: nextTotal
          }
        : {
            highMath: adminEditDraft.highMath,
            english: adminEditDraft.english,
            compTheory: adminEditDraft.compTheory,
            compPractical: adminEditDraft.compPractical,
            totalScore: nextTotal,
            firstChoice: nextFirstChoice
          };

      await api.put(`/admin/scores/${score.id}`, payload);
      alert('修改成功');
      handleAdminCancelEdit();
      fetchScores();
    } catch (err) {
      if (err.response?.status === 401 || err.response?.status === 403) {
        alert('管理员登录已过期，请重新登录');
        setIsAdmin(false);
        setShowAdminLogin(true);
        refreshAdminSession();
        return;
      }
      alert(getApiErrorMessage(err, '修改失败，请稍后重试'));
    } finally {
      setIsSavingAdminEdit(false);
    }
  };

  const handleBatchSelect = (batchType) => {
    setIsAdmissionStatsOpen(false);
    if (batchType === selectedBatch) return;
    setSelectedBatch(batchType);
    setSchoolSearchQuery('');
    setIsSchoolDropdownOpen(false);
    setFirstChoiceSearchQuery('');
    setIsFirstChoiceDropdownOpen(false);
  };

  const handlePageSizeChange = (value) => {
    const nextPageSize = Number.parseInt(String(value || ''), 10);
    if (!Number.isInteger(nextPageSize) || nextPageSize <= 0 || nextPageSize === pageSize) {
      return;
    }

    setPageSize(nextPageSize);
    setCurrentPage(1);
  };

  const handlePageChange = (page) => {
    const nextPage = Math.min(
      Math.max(1, Number.parseInt(String(page || ''), 10) || 1),
      pagination.totalPages
    );

    if (nextPage === currentPage) {
      return;
    }

    setCurrentPage(nextPage);
  };

  const handleOpenAdmissionStats = () => {
    setAdmissionStatsBatch(
      selectedBatch === BATCH_TYPES.RETIRED || selectedBatch === BATCH_TYPES.ADMISSION_RETIRED
        ? BATCH_TYPES.ADMISSION_RETIRED
        : BATCH_TYPES.ADMISSION
    );
    setAdmissionStatsStatus('');
    setIsAdmissionStatsOpen(true);
  };

  const handleAdmissionStatsBatchChange = (batchType) => {
    if (batchType === admissionStatsBatch) {
      return;
    }
    setAdmissionStatsBatch(batchType);
    setAdmissionRangeStats(null);
    setAdmissionStatsStatus('');
  };

  const handleManualRefreshAdmissionStats = () => {
    fetchAdmissionRangeStats({ showLoading: true });
  };

  const emptyColSpan = isAdmissionBatch
    ? (isAdminView ? (isNormalAdmissionBatch ? 7 : 6) : 4)
    : isRetiredBatch
      ? (isAdminView ? 6 : 4)
      : (isAdminView ? 11 : 9);

  const renderAdmissionScoreValue = (value) => (
    value === null || value === undefined ? '-' : formatScoreDisplay(value)
  );

  const renderAdmissionStatsModal = () => (
    <div className="fixed inset-0 z-50 bg-gray-900/55 p-3 md:p-8">
      <div className="mx-auto flex h-full max-w-7xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="border-b border-gray-100 px-4 py-4 md:px-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-xl font-bold text-gray-800">
                <BarChart3 size={22} className="text-blue-600" /> 院校最低/最高分统计
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                当前统计 {admissionStatsBatchLabel} 录取结果，最低分和最高分只计算正常考生。
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleManualRefreshAdmissionStats}
                disabled={isLoadingAdmissionStats}
                className="inline-flex items-center gap-1.5 rounded border border-blue-100 px-3 py-1.5 text-xs text-blue-700 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
                title="刷新统计"
              >
                <RefreshCw size={14} className={clsx(isLoadingAdmissionStats && 'animate-spin')} />
                刷新
              </button>
              <button
                type="button"
                onClick={() => setIsAdmissionStatsOpen(false)}
                className="inline-flex items-center gap-1.5 rounded border border-gray-200 px-3 py-1.5 text-xs text-gray-600 transition hover:bg-gray-50"
                title="关闭统计界面"
              >
                <X size={14} /> 关闭
              </button>
            </div>
          </div>
        </div>

        <div className="border-b border-gray-100 px-4 py-3 md:px-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="inline-flex w-full rounded-lg bg-gray-100 p-1 sm:w-auto">
              {[
                { batchType: BATCH_TYPES.ADMISSION, label: '普通批次' },
                { batchType: BATCH_TYPES.ADMISSION_RETIRED, label: '退役批次' }
              ].map((item) => (
                <button
                  key={item.batchType}
                  type="button"
                  onClick={() => handleAdmissionStatsBatchChange(item.batchType)}
                  className={clsx(
                    'flex-1 rounded-md px-4 py-2 text-sm transition sm:flex-none',
                    admissionStatsBatch === item.batchType
                      ? 'bg-white text-blue-600 shadow-sm font-medium'
                      : 'text-gray-600 hover:bg-white/70 hover:text-gray-800'
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-3 overflow-hidden rounded-lg border border-gray-100 text-center text-sm lg:min-w-[420px]">
              <div className="px-3 py-2">
                <div className="text-xs text-gray-400">录取登记</div>
                <div className="font-semibold text-gray-800">{admissionStatsTotals.totalCount}</div>
              </div>
              <div className="border-l border-gray-100 px-3 py-2">
                <div className="text-xs text-gray-400">有效统计</div>
                <div className="font-semibold text-gray-800">{admissionStatsTotals.eligibleCount}</div>
              </div>
              <div className="border-l border-gray-100 px-3 py-2">
                <div className="text-xs text-gray-400">已排除保送</div>
                <div className="font-semibold text-gray-800">{admissionStatsTotals.excludedRecommendedCount}</div>
              </div>
            </div>
          </div>
          {admissionStatsStatus && (
            <p className="mt-2 text-sm text-red-500">{admissionStatsStatus}</p>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="sticky top-0 z-10 border-b border-gray-100 bg-gray-50 text-gray-600">
              <tr>
                <th className="px-4 py-3 font-medium">院校</th>
                <th className="px-4 py-3 font-medium">专业</th>
                <th className="px-4 py-3 text-center font-medium">最低分</th>
                <th className="px-4 py-3 text-center font-medium">最高分</th>
                <th className="px-4 py-3 text-center font-medium">有效人数</th>
                <th className="px-4 py-3 text-center font-medium">登记人数</th>
                <th className="px-4 py-3 text-center font-medium">排除保送</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {admissionStatsRows.map((row) => (
                <tr key={`${row.school}-${row.major}`} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-800">{row.school}</td>
                  <td className="px-4 py-3 text-gray-600">{row.major}</td>
                  <td className="px-4 py-3 text-center font-semibold text-blue-700">
                    {renderAdmissionScoreValue(row.minScore)}
                  </td>
                  <td className="px-4 py-3 text-center font-semibold text-gray-800">
                    {renderAdmissionScoreValue(row.maxScore)}
                  </td>
                  <td className="px-4 py-3 text-center text-gray-700">{row.eligibleCount}</td>
                  <td className="px-4 py-3 text-center text-gray-500">{row.totalCount}</td>
                  <td className="px-4 py-3 text-center text-gray-500">{row.excludedRecommendedCount}</td>
                </tr>
              ))}
              {admissionStatsRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-gray-400">
                    {isLoadingAdmissionStats ? '统计数据加载中...' : '暂无可统计的院校数据'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="border-t border-gray-100 px-4 py-3 text-xs text-gray-400 md:px-6">
          数据每 {AUTO_REFRESH_INTERVAL_MS / 1000} 秒自动刷新；普通批次最低/最高分会排除录取结果中标记为保送生的学生。
        </div>
      </div>
    </div>
  );

  const renderAdminLoginPanel = (showCancel = true) => (
    <>
      <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
        <Shield size={20} className="text-blue-600" /> 管理员登录
      </h3>
      <form onSubmit={handleAdminLogin}>
        <input
          type="password"
          className="w-full border rounded px-3 py-2 mb-4"
          placeholder="请输入管理员密码"
          value={adminPassword}
          onChange={(e) => setAdminPassword(e.target.value)}
          autoFocus
        />
        <div className="flex justify-end gap-2">
          {showCancel && (
            <button
              type="button"
              onClick={closeAdminLoginModal}
              className="px-3 py-1.5 text-gray-600 hover:bg-gray-100 rounded"
            >
              取消
            </button>
          )}
          <button
            type="submit"
            disabled={isRefreshingAdmin}
            className="px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            登录
          </button>
        </div>
      </form>
    </>
  );

  if (isAdminPage && !isAdmin) {
    return (
      <div className="min-h-screen bg-gray-50 p-4 md:p-8">
        <div className="max-w-sm mx-auto pt-14 md:pt-24">
          <div className="bg-white p-6 rounded-lg shadow-xl border border-gray-100">
            {renderAdminLoginPanel(false)}
          </div>
        </div>
      </div>
    );
  }

  if (!selectedBatch) {
    return (
      <div className="min-h-screen bg-gray-50 p-4 md:p-8">
        <div className="max-w-md mx-auto pt-14 md:pt-24">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
              <Activity className="text-blue-600" />
              {DEFAULT_APP_TITLE}
            </h1>
            <div className="mt-5 inline-flex flex-wrap gap-1 rounded-lg bg-gray-100 p-1">
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
    <div className="min-h-screen bg-gray-50 p-3 md:p-8" data-build-version={UI_BUILD_VERSION}>
      <div className="max-w-7xl mx-auto space-y-4 md:space-y-6">
        <div className="bg-white rounded-xl shadow-sm p-4 md:p-6">
          <div className="mb-3 max-w-full">
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-gray-100 p-1 md:inline-flex md:min-w-max">
              {Object.entries(BATCH_META).map(([batchType, meta]) => (
                <button
                  key={batchType}
                  type="button"
                  onClick={() => handleBatchSelect(batchType)}
                  className={clsx(
                    'min-w-0 whitespace-nowrap rounded-md border px-3 py-2 text-center text-sm transition md:px-5 md:text-base',
                    selectedBatch === batchType
                      ? 'border-blue-100 bg-white text-blue-600 shadow-sm font-medium'
                      : 'border-transparent bg-white/60 text-gray-600 hover:bg-white hover:text-gray-800'
                  )}
                >
                  {meta.label}
                </button>
              ))}
            </div>
          </div>
          <div className={clsx(
            'flex flex-col gap-3 md:grid md:items-center md:gap-4',
            isAdminView
              ? 'md:grid-cols-[minmax(0,1fr)_minmax(280px,460px)_auto]'
              : 'md:grid-cols-[minmax(0,1fr)_auto]'
          )}>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                <Activity className="text-blue-600" />
                {currentBatchMeta.title}
              </h1>
              <p className="text-gray-500 text-sm mt-1">
                当前为 {currentBatchMeta.label}，共有 {scoreStats.totalCount} 位同学登记（{currentBatchMeta.rankHint}）
              </p>
              <p className="text-gray-400 text-xs flex items-center gap-1 mt-1">
                <MessageCircle size={12} /> 反馈/联系vx: zhangzh930
              </p>
              {isAdminView && (
                <div className="mt-2 inline-flex items-center gap-2 text-xs bg-red-50 text-red-700 border border-red-200 px-2.5 py-1 rounded-full">
                  <Shield size={12} /> 管理员模式（可添加、修改、删除记录）
                </div>
              )}
            </div>

            {isAdminView && (
              <form onSubmit={handleAdminSearch} className="w-full md:justify-self-center">
                <div className="flex items-center overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm focus-within:border-blue-300 focus-within:ring-2 focus-within:ring-blue-100">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center text-gray-400">
                    <Search size={16} />
                  </div>
                  <input
                    type="search"
                    className="h-10 min-w-0 flex-1 border-0 px-0 text-sm text-gray-700 outline-none placeholder:text-gray-400"
                    placeholder="搜索学生姓名"
                    value={adminSearchKeyword}
                    onChange={(event) => setAdminSearchKeyword(event.target.value)}
                  />
                  <button
                    type="submit"
                    disabled={isAdminSearching}
                    className="m-1 h-8 shrink-0 rounded-md bg-blue-600 px-3 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isAdminSearching ? '搜索中' : '定位'}
                  </button>
                </div>
                {adminSearchStatus && (
                  <p className="mt-1 truncate text-xs text-gray-500" title={adminSearchStatus}>
                    {adminSearchStatus}
                  </p>
                )}
              </form>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2 md:justify-self-end">
              {isAdminView ? (
                <>
                  <button
                    type="button"
                    onClick={handleOpenAdmissionStats}
                    className="px-3 py-1.5 text-xs text-blue-700 border border-blue-200 rounded hover:bg-blue-50 transition flex items-center gap-1.5"
                    title="院校最低/最高分统计"
                  >
                    <BarChart3 size={14} /> 最低/最高分
                  </button>
                  <button
                    type="button"
                    onClick={handleToggleScoreProtection}
                    disabled={isLoadingScoreProtection || isSavingScoreProtection}
                    className={clsx(
                      'px-3 py-1.5 text-xs border rounded transition flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-60',
                      scoreProtectionEnabled
                        ? 'border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100'
                        : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                    )}
                    title={scoreProtectionEnabled ? '关闭登记防护' : '开启登记防护'}
                    aria-pressed={scoreProtectionEnabled}
                  >
                    <Shield size={14} />
                    {isSavingScoreProtection
                      ? '保存中'
                      : `登记防护：${scoreProtectionEnabled ? '开' : '关'}`}
                  </button>
                  <button
                    onClick={handleExportScores}
                    className="px-3 py-1.5 text-xs text-emerald-700 border border-emerald-200 rounded hover:bg-emerald-50 transition flex items-center gap-1.5"
                    title="下载Excel"
                  >
                    <Download size={14} /> 下载Excel
                  </button>
                  <button
                    onClick={handleAdminLogout}
                    className="px-3 py-1.5 text-xs text-red-600 border border-red-200 rounded hover:bg-red-50 transition"
                    title="退出管理员"
                  >
                    退出管理员
                  </button>
                </>
              ) : !isAdminPage ? (
                <div className="flex w-full items-center justify-end gap-2 md:w-auto">
                  {!myRecord ? (
                    <button
                      onClick={() => handleEditClick(null)}
                      className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-white transition hover:bg-blue-700"
                    >
                      <Edit2 size={16} /> {myId ? '重新登记' : '立即登记'}
                    </button>
                  ) : (
                    <div className="flex min-w-0 flex-col items-end gap-1 text-right">
                      <span className="text-sm text-gray-600">
                        欢迎回来, <span className="font-bold text-blue-600">{myRecord.name}</span>
                      </span>
                      <div className="flex items-center justify-end gap-2">
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs text-amber-700">
                          已完成登记，如需修改请联系管理员
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}

            </div>
          </div>
          {isAdminView && scoreProtectionStatus && (
            <p className="mt-2 text-xs text-gray-500">
              {scoreProtectionStatus}
            </p>
          )}
        </div>

        {showAdminLogin && !isAdminPage && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-sm">
              {renderAdminLoginPanel(true)}
            </div>
          </div>
        )}

        {isAdminView && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 md:p-5">
            <form onSubmit={handleAdminAddScore} className="space-y-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <h2 className="text-base font-semibold text-gray-800 flex items-center gap-2">
                  <Plus size={18} className="text-blue-600" /> 添加记录
                </h2>
                <button
                  type="submit"
                  disabled={isAddingAdminScore}
                  className="inline-flex items-center justify-center gap-2 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Save size={16} /> {isAddingAdminScore ? '添加中...' : '保存记录'}
                </button>
              </div>

              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700">姓名</label>
                  <input
                    required
                    type="text"
                    className="w-full border rounded px-3 py-2"
                    value={adminAddDraft.name}
                    onChange={(event) => handleAdminAddDraftChange('name', event.target.value)}
                    placeholder="请输入真实姓名"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700">{adminTotalMeta.label}</label>
                  <input
                    required
                    type="number"
                    step="0.5"
                    min="0"
                    max={adminTotalMeta.max}
                    className="w-full border rounded px-3 py-2"
                    value={adminAddDraft.totalScore}
                    onChange={(event) => handleAdminAddDraftChange('totalScore', event.target.value)}
                    placeholder={`请输入${adminTotalMeta.label}`}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700">{contactFieldMeta.label}</label>
                  <input
                    type="text"
                    inputMode={usesWechatContact ? 'text' : 'numeric'}
                    pattern={usesWechatContact ? undefined : '[0-9]*'}
                    className="w-full border rounded px-3 py-2"
                    value={adminAddDraft.qq}
                    onChange={(event) => handleAdminAddDraftChange('qq', event.target.value)}
                    placeholder={contactFieldMeta.placeholder}
                  />
                </div>

                {isNormalBatch && (
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-gray-700">机构</label>
                    <input
                      type="text"
                      className="w-full border rounded px-3 py-2"
                      value={adminAddDraft.institution}
                      onChange={(event) => handleAdminAddDraftChange('institution', event.target.value)}
                      placeholder="请输入机构名称"
                    />
                  </div>
                )}

                {isNormalAdmissionBatch && (
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-gray-700">是否保送生</label>
                    <select
                      className="w-full border rounded bg-white px-3 py-2"
                      value={adminAddDraft.isRecommended}
                      onChange={(event) => handleAdminAddDraftChange('isRecommended', event.target.value)}
                    >
                      <option value="no">否</option>
                      <option value="yes">是</option>
                    </select>
                  </div>
                )}
              </div>

              {isNormalBatch && (
                <div className="grid gap-3 rounded-lg bg-gray-50 p-3 md:grid-cols-5">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-gray-700">高数成绩</label>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      max="150"
                      className="w-full border rounded px-3 py-2"
                      value={adminAddDraft.highMath}
                      onChange={(event) => handleAdminAddDraftChange('highMath', event.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-gray-700">外语成绩</label>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      max="120"
                      className="w-full border rounded px-3 py-2"
                      value={adminAddDraft.english}
                      onChange={(event) => handleAdminAddDraftChange('english', event.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-gray-700">理论成绩</label>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      max="150"
                      className="w-full border rounded px-3 py-2"
                      value={adminAddDraft.compTheory}
                      onChange={(event) => handleAdminAddDraftChange('compTheory', event.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-gray-700">实操成绩</label>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      max="80"
                      className="w-full border rounded px-3 py-2"
                      value={adminAddDraft.compPractical}
                      onChange={(event) => handleAdminAddDraftChange('compPractical', event.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-gray-700">一志愿</label>
                    <select
                      className="w-full border rounded bg-white px-3 py-2"
                      value={adminAddDraft.firstChoice}
                      onChange={(event) => handleAdminAddDraftChange('firstChoice', event.target.value)}
                    >
                      <option value="">未填写</option>
                      {NORMAL_FIRST_CHOICE_OPTIONS.map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {isRetiredBatch && (
                <div className="grid gap-3 rounded-lg bg-gray-50 p-3 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-gray-700">一志愿</label>
                    <select
                      className="w-full border rounded bg-white px-3 py-2"
                      value={adminAddDraft.firstChoice}
                      onChange={(event) => handleAdminAddDraftChange('firstChoice', event.target.value)}
                    >
                      <option value="">未填写</option>
                      {retiredFirstChoiceSchoolOptions.map((school) => (
                        <option key={school} value={school}>{school}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {isAdmissionBatch && (
                <div className="grid gap-3 rounded-lg bg-gray-50 p-3 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-gray-700">录取院校</label>
                    <input
                      type="text"
                      className="w-full border rounded px-3 py-2"
                      value={adminAddDraft.admissionSchool}
                      onChange={(event) => handleAdminAddDraftChange('admissionSchool', event.target.value)}
                      placeholder="请输入录取院校"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-gray-700">录取专业</label>
                    <input
                      type="text"
                      className="w-full border rounded px-3 py-2"
                      value={adminAddDraft.admissionMajor}
                      onChange={(event) => handleAdminAddDraftChange('admissionMajor', event.target.value)}
                      placeholder="请输入录取专业"
                    />
                  </div>
                </div>
              )}
            </form>
          </div>
        )}

        {!isAdminPage && (
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
        )}

        {!isAdminPage && isEditing && (
          <div className="bg-white rounded-xl shadow-lg p-6 border border-blue-100 animate-in fade-in slide-in-from-top-4">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              {isAdmissionBatch
                ? (myId ? '重新登记录取结果' : '录取结果登记')
                : isRetiredBatch
                  ? (myId ? '重新登记退役批次信息' : '退役批次登记')
                  : (myId ? '重新登记信息' : '用户登记')}
              <span className="text-xs font-normal text-gray-400">
                （首次登记后学生端不可二次修改，如需调整请联系管理员）
              </span>
            </h2>

            <form onSubmit={handleSubmit} className="space-y-6">
              {isAdmissionBatch ? (
                <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700">姓名</label>
                    <input
                      required
                      type="text"
                      className="w-full border rounded px-3 py-2"
                      value={formData.name}
                      onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                      placeholder="请输入真实姓名"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700">{contactFieldMeta.label}</label>
                    <input
                      required={requiresContact}
                      type="text"
                      inputMode={usesWechatContact ? 'text' : 'numeric'}
                      pattern={usesWechatContact ? undefined : '[1-9][0-9]{4,14}'}
                      className="w-full border rounded px-3 py-2"
                      value={formData.qq}
                      onChange={(e) => setFormData((prev) => ({
                        ...prev,
                        qq: usesWechatContact ? e.target.value : e.target.value.replace(/\D/g, '')
                      }))}
                      placeholder={contactFieldMeta.placeholder}
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700">录取分数</label>
                    <input
                      required
                      type="number"
                      step="0.5"
                      min="0"
                      className="w-full border rounded px-3 py-2"
                      value={formData.admissionScore}
                      onChange={(e) => setFormData((prev) => ({
                        ...prev,
                        admissionScore: e.target.value
                      }))}
                      placeholder="请输入录取分数"
                    />
                  </div>

                  {isNormalAdmissionBatch && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-700">是否为保送生</label>
                      <select
                        required
                        className="w-full border rounded px-3 py-2 bg-white"
                        value={formData.isRecommended}
                        onChange={(e) => setFormData((prev) => ({
                          ...prev,
                          isRecommended: e.target.value
                        }))}
                      >
                        <option value="">请选择</option>
                        <option value="no">否</option>
                        <option value="yes">是</option>
                      </select>
                    </div>
                  )}

                  <div className="space-y-2 md:col-span-2 lg:col-span-2">
                    <label className="text-sm font-medium text-gray-700">录取院校</label>
                    <div className="relative">
                      <input
                        required
                        type="text"
                        className="w-full border rounded px-3 py-2"
                        value={schoolSearchQuery}
                        onFocus={() => setIsSchoolDropdownOpen(true)}
                        onBlur={() => window.setTimeout(() => setIsSchoolDropdownOpen(false), 120)}
                        onChange={(e) => handleSchoolSearchChange(e.target.value)}
                        placeholder={admissionOptions.length > 0 ? '输入学校关键词搜索，例如：苏州' : '当前批次暂无可选院校'}
                        disabled={admissionOptions.length === 0}
                      />
                      {isSchoolDropdownOpen && admissionOptions.length > 0 && (
                        <div className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg">
                          {filteredSchoolOptions.length > 0 ? filteredSchoolOptions.map((item) => (
                            <button
                              key={item.school}
                              type="button"
                              onMouseDown={() => handleSchoolSelect(item.school)}
                              className={clsx(
                                'w-full px-3 py-2 text-left text-sm transition hover:bg-blue-50',
                                formData.admissionSchool === item.school && 'bg-blue-50 text-blue-600'
                              )}
                            >
                              {item.school}
                            </button>
                          )) : (
                            <div className="px-3 py-2 text-sm text-gray-400">
                              未找到匹配院校，请换个关键词
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    <p className="text-xs text-gray-400">
                      只能从文档提供的院校中选择，不能自定义输入
                    </p>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700">录取专业</label>
                    <select
                      required
                      className="w-full border rounded px-3 py-2 bg-white disabled:bg-gray-100 disabled:text-gray-400"
                      value={formData.admissionMajor}
                      onChange={(e) => setFormData((prev) => ({
                        ...prev,
                        admissionMajor: e.target.value
                      }))}
                      disabled={!formData.admissionSchool}
                    >
                      <option value="">
                        {formData.admissionSchool ? '请选择录取专业' : '请先选择录取院校'}
                      </option>
                      {availableMajors.map((major) => (
                        <option key={major} value={major}>{major}</option>
                      ))}
                    </select>
                  </div>
                </div>
              ) : (
                <>
                  <div className={clsx(
                    'grid gap-4',
                    isRetiredBatch ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4'
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

                    {!isRetiredBatch && (
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-700">机构</label>
                        <select
                          className="w-full border rounded px-3 py-2 bg-white"
                          value={isCustomInstitution ? CUSTOM_INSTITUTION_VALUE : DEFAULT_INSTITUTION}
                          onChange={(e) => handleInstitutionSelectChange(e.target.value)}
                        >
                          {INSTITUTION_OPTIONS.map((option) => (
                            <option key={option} value={option}>{option}</option>
                          ))}
                          <option value={CUSTOM_INSTITUTION_VALUE}>自定义</option>
                        </select>
                        {isCustomInstitution && (
                          <input
                            required
                            type="text"
                            className="w-full border rounded px-3 py-2"
                            value={formData.institution}
                            onChange={(e) => setFormData({
                              ...formData,
                              institution: e.target.value
                            })}
                            placeholder="请输入机构名称"
                          />
                        )}
                      </div>
                    )}

                    <div className={clsx(
                      'space-y-2',
                      !isRetiredBatch && 'md:col-span-2 lg:col-span-2'
                    )}>
                      <label className="text-sm font-medium text-gray-700">{contactFieldMeta.label}</label>
                      <input
                        required
                        type="text"
                        inputMode={usesWechatContact ? 'text' : 'numeric'}
                        pattern={usesWechatContact ? undefined : '[1-9][0-9]{4,14}'}
                        className="w-full border rounded px-3 py-2"
                        value={formData.qq}
                        onChange={(e) => setFormData({
                          ...formData,
                          qq: usesWechatContact ? e.target.value : e.target.value.replace(/\D/g, '')
                        })}
                        placeholder={contactFieldMeta.placeholder}
                      />
                    </div>

                  </div>

                  {!isRetiredBatch ? (
                    <div className="space-y-4">
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
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="rounded-lg border border-blue-100 bg-blue-50 p-4">
                          <div className="text-sm font-medium text-blue-900">当前总分</div>
                          <div className="mt-2 text-2xl font-bold text-blue-700">
                            {formatScoreDisplay(normalBatchTotalScore)}
                          </div>
                          <p className="mt-2 text-xs text-blue-700/80">
                            总分达到 {NORMAL_FIRST_CHOICE_THRESHOLD} 分及以上时，需要填写一志愿。
                          </p>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-gray-700">一志愿为</label>
                          <select
                            className={clsx(
                              'w-full border rounded px-3 py-2 transition',
                              shouldChooseNormalFirstChoice
                                ? 'bg-white'
                                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                            )}
                            value={formData.firstChoice}
                            onChange={(e) => setFormData({ ...formData, firstChoice: e.target.value })}
                            disabled={!shouldChooseNormalFirstChoice}
                            required={shouldChooseNormalFirstChoice}
                          >
                            <option value="">
                              {shouldChooseNormalFirstChoice ? '请选择一志愿' : `总分达到 ${NORMAL_FIRST_CHOICE_THRESHOLD} 分及以上后可选择`}
                            </option>
                            {NORMAL_FIRST_CHOICE_OPTIONS.map((option) => (
                              <option key={option} value={option}>{option}</option>
                            ))}
                          </select>
                          <p className="text-xs text-gray-400">
                            低于 {NORMAL_FIRST_CHOICE_THRESHOLD} 分时禁止填写。
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="grid gap-4 rounded-lg bg-gray-50 p-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-700">分数</label>
                        <input
                          required
                          type="number"
                          step="0.5"
                          min="0"
                          max="150"
                          className="w-full border rounded px-3 py-2"
                          value={formData.compTheory}
                          onChange={(e) => setFormData({ ...formData, compTheory: e.target.value })}
                          placeholder="请输入分数"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-700">一志愿</label>
                        <div className="relative">
                          <input
                            required
                            type="text"
                            className="w-full border rounded px-3 py-2"
                            value={firstChoiceSearchQuery}
                            onFocus={() => setIsFirstChoiceDropdownOpen(true)}
                            onBlur={() => window.setTimeout(() => setIsFirstChoiceDropdownOpen(false), 120)}
                            onChange={(e) => handleFirstChoiceSearchChange(e.target.value)}
                            placeholder={retiredFirstChoiceSchoolOptions.length > 0 ? '输入院校关键词搜索，例如：常州' : '院校数据加载中...'}
                            disabled={retiredFirstChoiceSchoolOptions.length === 0}
                          />
                          {isFirstChoiceDropdownOpen && retiredFirstChoiceSchoolOptions.length > 0 && (
                            <div className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg">
                              {filteredFirstChoiceSchoolOptions.length > 0 ? filteredFirstChoiceSchoolOptions.map((school) => (
                                <button
                                  key={school}
                                  type="button"
                                  onMouseDown={() => handleFirstChoiceSchoolSelect(school)}
                                  className={clsx(
                                    'w-full px-3 py-2 text-left text-sm transition hover:bg-blue-50',
                                    formData.firstChoice === school && 'bg-blue-50 text-blue-600'
                                  )}
                                >
                                  {school}
                                </button>
                              )) : (
                                <div className="px-3 py-2 text-sm text-gray-400">
                                  未找到匹配院校，请换个关键词
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                </>
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
                  disabled={isSubmitting}
                  className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 flex items-center gap-2"
                >
                  <Save size={16} /> {isSubmitting ? '提交中...' : '保存提交'}
                </button>
              </div>
            </form>
          </div>
        )}

        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="relative overflow-x-auto">
            <table className="min-w-max w-full text-center text-sm">
              <thead className="bg-gray-100 text-gray-600 font-medium border-b">
                <tr>
                  {shouldShowRankingColumn && (
                    <th className="sticky left-0 z-30 w-[72px] min-w-[72px] max-w-[72px] whitespace-nowrap bg-gray-100 px-4 py-3 shadow-[1px_0_0_0_rgba(229,231,235,1)]">
                      排名
                    </th>
                  )}
                  <th
                    className="sticky z-20 overflow-hidden whitespace-nowrap bg-gray-100 px-4 py-3 shadow-[1px_0_0_0_rgba(229,231,235,1)]"
                    style={{
                      left: shouldShowRankingColumn ? `${RANK_COLUMN_WIDTH}px` : 0,
                      width: `${NAME_COLUMN_WIDTH}px`,
                      minWidth: `${NAME_COLUMN_WIDTH}px`,
                      maxWidth: `${NAME_COLUMN_WIDTH}px`
                    }}
                  >
                    姓名
                  </th>
                  {isAdminView && <th className="px-4 py-3 whitespace-nowrap">{contactFieldMeta.shortLabel}</th>}
                  {isAdmissionBatch ? (
                    <>
                      <th className="px-4 py-3 whitespace-nowrap">录取分数</th>
                      {isNormalAdmissionBatch && isAdminView && (
                        <th className="px-4 py-3 whitespace-nowrap">是否保送生</th>
                      )}
                      <th className="px-4 py-3 whitespace-nowrap">录取院校</th>
                      <th className="px-4 py-3 whitespace-nowrap">录取专业</th>
                    </>
                  ) : isRetiredBatch ? (
                    <>
                      <th className="px-4 py-3 whitespace-nowrap">分数</th>
                      <th className="px-4 py-3 whitespace-nowrap">一志愿</th>
                    </>
                  ) : (
                    <>
                      <th className="px-4 py-3 whitespace-nowrap">机构</th>
                      <th className="px-4 py-3 whitespace-nowrap">高数成绩</th>
                      <th className="px-4 py-3 whitespace-nowrap">外语成绩</th>
                      <th className="px-4 py-3 whitespace-nowrap">理论成绩</th>
                      <th className="px-4 py-3 whitespace-nowrap">实操成绩</th>
                      <th className="px-4 py-3 whitespace-nowrap">总分</th>
                      <th className="px-4 py-3 whitespace-nowrap">一志愿</th>
                    </>
                  )}
                  {isAdminView && <th className="px-4 py-3 whitespace-nowrap">操作</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {scores.map((score) => {
                  const isAdminEditingThisRow = isAdminView && adminEditingScoreId === score.id && Boolean(adminEditDraft);
                  const isAdminSearchTargetRow = isAdminView && score.id === adminSearchTargetId;
                  const stickyCellBackgroundClass = isAdminSearchTargetRow
                    ? 'bg-amber-50'
                    : score.id === myId
                      ? 'bg-blue-50'
                      : 'bg-white';
                  const totalScore = getScoreTotal(score, selectedBatch);
                  const adminPreviewTotal = isAdminEditingThisRow
                    ? parseScore(adminEditDraft.totalScore)
                    : totalScore;
                  const scoreInputClassName = 'w-24 rounded border border-blue-200 px-2 py-1 text-center text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100';

                  return (
                    <tr
                      key={score.id}
                      id={`score-row-${score.id}`}
                      className={clsx(
                        'hover:bg-gray-50 transition-colors',
                        score.id === myId && 'bg-blue-50 hover:bg-blue-100 font-medium',
                        isAdminSearchTargetRow && 'bg-amber-50 hover:bg-amber-100 ring-2 ring-amber-300 ring-inset'
                      )}
                    >
                      {shouldShowRankingColumn && (
                        <td className={clsx(
                          'sticky left-0 z-30 w-[72px] min-w-[72px] max-w-[72px] whitespace-nowrap px-4 py-3 font-semibold text-gray-700 shadow-[1px_0_0_0_rgba(229,231,235,1)]',
                          stickyCellBackgroundClass
                        )}>
                          {score.rank ?? '-'}
                        </td>
                      )}
                      <td
                        className={clsx(
                          'sticky z-20 overflow-hidden px-4 py-3 shadow-[1px_0_0_0_rgba(229,231,235,1)]',
                          stickyCellBackgroundClass
                        )}
                        style={{
                          left: shouldShowRankingColumn ? `${RANK_COLUMN_WIDTH}px` : 0,
                          width: `${NAME_COLUMN_WIDTH}px`,
                          minWidth: `${NAME_COLUMN_WIDTH}px`,
                          maxWidth: `${NAME_COLUMN_WIDTH}px`
                        }}
                      >
                        <div className="flex min-w-0 items-center justify-center gap-2 overflow-hidden whitespace-nowrap">
                          <span className="truncate">{score.name}</span>
                          {score.id === myId && <span className="text-xs bg-blue-200 text-blue-800 px-1.5 rounded">我</span>}
                        </div>
                      </td>
                      {isAdminView && (
                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{score.qq || '-'}</td>
                      )}

                      {isAdmissionBatch ? (
                        <>
                          <td className="px-4 py-3 font-bold text-gray-800 whitespace-nowrap">{totalScore}</td>
                          {isNormalAdmissionBatch && isAdminView && (
                            <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                              {score.isRecommended ? '是' : '否'}
                            </td>
                          )}
                          <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{score.admissionSchool || '-'}</td>
                          <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{score.admissionMajor || '-'}</td>
                        </>
                      ) : isRetiredBatch ? (
                        <>
                          <td className="px-4 py-3 font-bold text-gray-800 whitespace-nowrap">
                            {isAdminEditingThisRow ? (
                              <input
                                type="number"
                                step="0.5"
                                min="0"
                                max="150"
                                className={scoreInputClassName}
                                value={adminEditDraft.totalScore}
                                onChange={(e) => handleAdminEditFieldChange('totalScore', e.target.value)}
                                disabled={isSavingAdminEdit}
                              />
                            ) : formatScoreDisplay(totalScore)}
                          </td>
                          <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                            {score.firstChoice || '-'}
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{score.institution || '-'}</td>
                          <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                            {isAdminEditingThisRow ? (
                              <input
                                type="number"
                                step="0.5"
                                min="0"
                                max="150"
                                className={scoreInputClassName}
                                value={adminEditDraft.highMath}
                                onChange={(e) => handleAdminEditFieldChange('highMath', e.target.value)}
                                disabled={isSavingAdminEdit}
                              />
                            ) : formatOptionalScoreDisplay(score.highMath)}
                          </td>
                          <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                            {isAdminEditingThisRow ? (
                              <input
                                type="number"
                                step="0.5"
                                min="0"
                                max="120"
                                className={scoreInputClassName}
                                value={adminEditDraft.english}
                                onChange={(e) => handleAdminEditFieldChange('english', e.target.value)}
                                disabled={isSavingAdminEdit}
                              />
                            ) : formatOptionalScoreDisplay(score.english)}
                          </td>
                          <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                            {isAdminEditingThisRow ? (
                              <input
                                type="number"
                                step="0.5"
                                min="0"
                                max="150"
                                className={scoreInputClassName}
                                value={adminEditDraft.compTheory}
                                onChange={(e) => handleAdminEditFieldChange('compTheory', e.target.value)}
                                disabled={isSavingAdminEdit}
                              />
                            ) : formatOptionalScoreDisplay(score.compTheory)}
                          </td>
                          <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                            {isAdminEditingThisRow ? (
                              <input
                                type="number"
                                step="0.5"
                                min="0"
                                max="80"
                                className={scoreInputClassName}
                                value={adminEditDraft.compPractical}
                                onChange={(e) => handleAdminEditFieldChange('compPractical', e.target.value)}
                                disabled={isSavingAdminEdit}
                              />
                            ) : formatOptionalScoreDisplay(score.compPractical)}
                          </td>
                          <td className="px-4 py-3 font-bold text-gray-800 whitespace-nowrap">
                            {isAdminEditingThisRow ? (
                              <input
                                type="number"
                                step="0.5"
                                min="0"
                                max="500"
                                className={scoreInputClassName}
                                value={adminEditDraft.totalScore}
                                onChange={(e) => handleAdminEditFieldChange('totalScore', e.target.value)}
                                disabled={isSavingAdminEdit}
                              />
                            ) : formatScoreDisplay(adminPreviewTotal)}
                          </td>
                          <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                            {isAdminEditingThisRow ? (
                              <select
                                className="min-w-40 rounded border border-blue-200 bg-white px-2 py-1 text-sm text-gray-700"
                                value={adminEditDraft.firstChoice}
                                onChange={(e) => handleAdminEditFieldChange('firstChoice', e.target.value)}
                                disabled={isSavingAdminEdit}
                              >
                                <option value="">未填写</option>
                                {NORMAL_FIRST_CHOICE_OPTIONS.map((option) => (
                                  <option key={option} value={option}>{option}</option>
                                ))}
                              </select>
                            ) : (score.firstChoice || '-')}
                          </td>
                        </>
                      )}

                      {isAdminView && (
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center justify-center gap-2">
                            {!isAdmissionBatch && !isAdminEditingThisRow && (
                              <button
                                type="button"
                                onClick={() => handleAdminStartEdit(score)}
                                className="text-blue-500 hover:text-blue-700 p-1 rounded hover:bg-blue-50 transition"
                                title="修改成绩"
                              >
                                <Edit2 size={16} />
                              </button>
                            )}
                            {!isAdmissionBatch && isAdminEditingThisRow && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleAdminSaveEdit(score)}
                                  disabled={isSavingAdminEdit}
                                  className="text-emerald-600 hover:text-emerald-700 p-1 rounded hover:bg-emerald-50 transition disabled:opacity-50"
                                  title="保存修改"
                                >
                                  <Save size={16} />
                                </button>
                                <button
                                  type="button"
                                  onClick={handleAdminCancelEdit}
                                  disabled={isSavingAdminEdit}
                                  className="text-gray-500 hover:text-gray-700 p-1 rounded hover:bg-gray-100 transition disabled:opacity-50"
                                  title="取消修改"
                                >
                                  <X size={16} />
                                </button>
                              </>
                            )}
                            <button
                              type="button"
                              onClick={() => handleDelete(score.id)}
                              className="text-red-500 hover:text-red-700 p-1 rounded hover:bg-red-50 transition"
                              title="删除记录"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
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
          <div className="border-t border-gray-100 px-4 py-4 sm:px-6">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600">
                <span>共 {pagination.totalItems} 条记录</span>
                <span>第 {pagination.page} / {pagination.totalPages} 页</span>
                <label className="flex items-center gap-2">
                  每页显示
                  <select
                    className="rounded-md border border-gray-200 bg-white px-2 py-1 text-sm text-gray-700"
                    value={pageSize}
                    onChange={(e) => handlePageSizeChange(e.target.value)}
                  >
                    {SCORE_PAGE_SIZE_OPTIONS.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                  条
                </label>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => handlePageChange(pagination.page - 1)}
                  disabled={!pagination.hasPrevPage}
                  className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  上一页
                </button>
                {visiblePageNumbers.map((page) => (
                  <button
                    key={page}
                    type="button"
                    onClick={() => handlePageChange(page)}
                    className={clsx(
                      'min-w-10 rounded-md border px-3 py-1.5 text-sm transition',
                      pagination.page === page
                        ? 'border-blue-600 bg-blue-600 text-white'
                        : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                    )}
                  >
                    {page}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => handlePageChange(pagination.page + 1)}
                  disabled={!pagination.hasNextPage}
                  className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  下一页
                </button>
              </div>
            </div>
          </div>
        </div>

      </div>
      {isAdminView && isAdmissionStatsOpen && renderAdmissionStatsModal()}
      {!isAdminPage && showConsultModal && (
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

