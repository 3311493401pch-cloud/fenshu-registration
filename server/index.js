const crypto = require('crypto');
const express = require('express');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const retiredAdmissionOptions = require('./admission-options.json');
const normalAdmissionOptions = require('./admission-options-normal.json');

const app = express();
app.set('trust proxy', 1);

const server = http.createServer(app);
const prisma = new PrismaClient();

const parseCsvList = (value) =>
  String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const toBoolean = (value, defaultValue = false) => {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
};

const parseRequiredBooleanChoice = (value) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return null;
};

const parseOptionalBooleanChoice = (value, defaultValue = false) => {
  const parsed = parseRequiredBooleanChoice(value);
  return parsed === null ? defaultValue : parsed;
};

const toPositiveInt = (value, defaultValue) => {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : defaultValue;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const stripPortFromIp = (value) => {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(text)) {
    return text.split(':')[0];
  }
  return text;
};

const normalizeClientIp = (value) =>
  stripPortFromIp(String(value || '').trim().replace(/^::ffff:/, ''));

const nowSeconds = () => Math.floor(Date.now() / 1000);

const parseSameSite = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'lax' || normalized === 'none') {
    return normalized;
  }
  return 'strict';
};

const isProd = process.env.NODE_ENV === 'production';
const CORS_ALLOW_ORIGINS = parseCsvList(
  process.env.CORS_ALLOW_ORIGINS || 'http://localhost:5173,http://localhost:4173'
);
const BLOCKED_SCORE_SUBMIT_IPS = new Set(parseCsvList(process.env.BLOCKED_SCORE_SUBMIT_IPS));
const ADMIN_TOTP_SECRET = process.env.ADMIN_TOTP_SECRET;
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || '');
const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET;
const ADMIN_TOKEN_TTL = process.env.ADMIN_TOKEN_TTL || '15m';
const ADMIN_TOTP_PERIOD = clamp(toPositiveInt(process.env.ADMIN_TOTP_PERIOD, 30), 30, 60);
const ADMIN_LOGIN_MAX_FAILURES = clamp(
  toPositiveInt(process.env.ADMIN_LOGIN_MAX_FAILURES, 5),
  3,
  10
);
const ADMIN_LOGIN_LOCK_MINUTES = clamp(
  toPositiveInt(process.env.ADMIN_LOGIN_LOCK_MINUTES, 15),
  5,
  60
);
const ADMIN_LOGIN_LOCK_MS = ADMIN_LOGIN_LOCK_MINUTES * 60 * 1000;
const ADMIN_COOKIE_NAME = process.env.ADMIN_COOKIE_NAME || 'fenshu_admin_session';
const ADMIN_COOKIE_SECURE = toBoolean(process.env.ADMIN_COOKIE_SECURE, isProd);
const ADMIN_COOKIE_SAME_SITE = parseSameSite(process.env.ADMIN_COOKIE_SAME_SITE);
const SCORE_SCREENSHOT_DIR = process.env.SCORE_SCREENSHOT_DIR || (
  isProd ? path.join('/app', 'data', 'uploads') : path.join(__dirname, 'uploads')
);
const SCORE_SUBMIT_TOKEN_TTL_SECONDS = clamp(
  toPositiveInt(process.env.SCORE_SUBMIT_TOKEN_TTL_SECONDS, 300),
  60,
  1800
);
const SCORE_SUBMIT_TOKEN_MAX_PER_MINUTE = clamp(
  toPositiveInt(process.env.SCORE_SUBMIT_TOKEN_MAX_PER_MINUTE, 20),
  5,
  60
);
const SCORE_SUBMIT_IP_NAME_WINDOW_SECONDS = clamp(
  toPositiveInt(process.env.SCORE_SUBMIT_IP_NAME_WINDOW_SECONDS, 600),
  60,
  3600
);
const SCORE_SUBMIT_IP_MAX_NAMES = clamp(
  toPositiveInt(process.env.SCORE_SUBMIT_IP_MAX_NAMES, 3),
  1,
  10
);
const SCORE_SUBMIT_TOKEN_TTL_MS = SCORE_SUBMIT_TOKEN_TTL_SECONDS * 1000;
const SCORE_SUBMIT_IP_NAME_WINDOW_MS = SCORE_SUBMIT_IP_NAME_WINDOW_SECONDS * 1000;
const SCORE_PROTECTION_SETTING_KEY = 'score_submit_protection_enabled';
const scoreSubmitTokens = new Map();
const scoreSubmitIpNameWindows = new Map();

const getScoreProtectionEnabled = async () => {
  try {
    const setting = await prisma.appSetting.findUnique({
      where: { key: SCORE_PROTECTION_SETTING_KEY }
    });
    return toBoolean(setting?.value, false);
  } catch (error) {
    console.error(`Error reading score protection setting: ${error.message}`);
    return false;
  }
};

const setScoreProtectionEnabled = async (enabled) => {
  const value = enabled ? 'true' : 'false';
  await prisma.appSetting.upsert({
    where: { key: SCORE_PROTECTION_SETTING_KEY },
    create: {
      key: SCORE_PROTECTION_SETTING_KEY,
      value
    },
    update: {
      value
    }
  });
  return enabled;
};

const withScoreProtection = (middleware) => async (req, res, next) => {
  try {
    if (!await getScoreProtectionEnabled()) {
      return next();
    }

    return middleware(req, res, next);
  } catch (error) {
    return next(error);
  }
};

const getClientIp = (req) => {
  const forwardedChain = String(req.headers['x-forwarded-for'] || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const forwarded = forwardedChain[forwardedChain.length - 1] || '';
  const fallback = req.ip || req.socket?.remoteAddress || '';
  return normalizeClientIp(forwarded || fallback);
};

const createCorsOriginValidator = () => {
  const allowAll = CORS_ALLOW_ORIGINS.length === 0;
  return (origin, callback) => {
    if (!origin || allowAll || CORS_ALLOW_ORIGINS.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error('Origin not allowed by CORS'));
  };
};

const getOriginFromReferer = (referer) => {
  try {
    return new URL(String(referer || '')).origin;
  } catch (error) {
    return '';
  }
};

const isAllowedWriteOrigin = (req) => {
  if (CORS_ALLOW_ORIGINS.length === 0) {
    return true;
  }

  const origin = String(req.headers.origin || '').trim();
  if (origin) {
    return CORS_ALLOW_ORIGINS.includes(origin);
  }

  const refererOrigin = getOriginFromReferer(req.headers.referer);
  return Boolean(refererOrigin && CORS_ALLOW_ORIGINS.includes(refererOrigin));
};

const requireSameSiteWriteRequest = (req, res, next) => {
  if (!isAllowedWriteOrigin(req)) {
    console.warn(`Blocked cross-site score submit from ${getClientIp(req) || 'unknown'}`);
    return res.status(403).json({ error: '提交来源异常，请从网站页面重新进入后再试' });
  }

  return next();
};

const hashScoreSubmitToken = (token) =>
  crypto.createHash('sha256').update(String(token || '')).digest('hex');

const purgeExpiredScoreSubmitState = () => {
  const now = Date.now();

  for (const [tokenHash, record] of scoreSubmitTokens.entries()) {
    if (!record || record.expiresAt <= now) {
      scoreSubmitTokens.delete(tokenHash);
    }
  }

  for (const [key, names] of scoreSubmitIpNameWindows.entries()) {
    for (const [name, expiresAt] of names.entries()) {
      if (expiresAt <= now) {
        names.delete(name);
      }
    }
    if (names.size === 0) {
      scoreSubmitIpNameWindows.delete(key);
    }
  }
};

const issueScoreSubmitToken = (req, res) => {
  purgeExpiredScoreSubmitState();

  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashScoreSubmitToken(token);
  scoreSubmitTokens.set(tokenHash, {
    expiresAt: Date.now() + SCORE_SUBMIT_TOKEN_TTL_MS,
    ip: getClientIp(req),
    userAgent: String(req.headers['user-agent'] || '')
  });

  res.set('Cache-Control', 'no-store');
  return res.json({
    token,
    expiresInSeconds: SCORE_SUBMIT_TOKEN_TTL_SECONDS
  });
};

const getScoreSubmitTokenFromRequest = (req) =>
  String(req.get('x-score-submit-token') || '').trim();

const requireScoreSubmitToken = (req, res, next) => {
  purgeExpiredScoreSubmitState();

  const token = getScoreSubmitTokenFromRequest(req);
  if (!token) {
    return res.status(403).json({ error: '提交令牌缺失，请刷新页面后重新提交' });
  }

  const tokenHash = hashScoreSubmitToken(token);
  const record = scoreSubmitTokens.get(tokenHash);
  scoreSubmitTokens.delete(tokenHash);

  if (!record || record.expiresAt <= Date.now()) {
    return res.status(403).json({ error: '提交令牌已失效，请刷新页面后重新提交' });
  }

  const clientIp = getClientIp(req);
  const userAgent = String(req.headers['user-agent'] || '');
  if (record.ip !== clientIp || record.userAgent !== userAgent) {
    console.warn(`Blocked score submit with mismatched token from ${clientIp || 'unknown'}`);
    return res.status(403).json({ error: '提交环境异常，请刷新页面后重新提交' });
  }

  return next();
};

const blockListedScoreSubmitIp = (req, res, next) => {
  const clientIp = getClientIp(req);
  if (clientIp && BLOCKED_SCORE_SUBMIT_IPS.has(clientIp)) {
    console.warn(`Blocked listed score submit IP ${clientIp}`);
    return res.status(403).json({ error: '提交来源异常，请从网站页面重新进入后再试' });
  }

  return next();
};

const publicScoreSubmitLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `score-submit:${getClientIp(req) || 'unknown'}`,
  handler: (req, res) => {
    console.warn(`Rate limited score submit from ${getClientIp(req) || 'unknown'}`);
    return res.status(429).json({ error: '提交过于频繁，请稍后再试' });
  }
});

const scoreSubmitTokenLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: SCORE_SUBMIT_TOKEN_MAX_PER_MINUTE,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `score-submit-token:${getClientIp(req) || 'unknown'}`,
  handler: (req, res) => {
    console.warn(`Rate limited score submit token from ${getClientIp(req) || 'unknown'}`);
    return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
  }
});

app.use(cors({
  origin: createCorsOriginValidator(),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));
app.options(/.*/, cors({
  origin: createCorsOriginValidator(),
  credentials: true
}));
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));
app.use(cookieParser());
app.get(
  '/api/score-submit-token',
  withScoreProtection(blockListedScoreSubmitIp),
  withScoreProtection(scoreSubmitTokenLimiter),
  withScoreProtection(requireSameSiteWriteRequest),
  issueScoreSubmitToken
);
app.post(
  '/api/scores',
  withScoreProtection(blockListedScoreSubmitIp),
  withScoreProtection(publicScoreSubmitLimiter),
  withScoreProtection(requireSameSiteWriteRequest),
  withScoreProtection(requireScoreSubmitToken)
);
app.use(express.json({ limit: '200kb' }));

// 健康检查端点（供 Render 等平台使用）
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

const SOCKET_IO_PATH = process.env.SOCKET_IO_PATH || '/fenshu/socket.io';

const io = new Server(server, {
  path: SOCKET_IO_PATH,
  cors: {
    origin: CORS_ALLOW_ORIGINS.length === 0 ? true : CORS_ALLOW_ORIGINS,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
  }
});

const maskName = (name) => {
  if (!name || name.length <= 1) return name;
  return name[0] + '*'.repeat(name.length - 1);
};

const sanitizePlainText = (value, maxLength) =>
  String(value || '')
    .replace(/[<>\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maxLength);

const sanitizeQQ = (value) => String(value || '').replace(/\D/g, '').slice(0, 15);

const BATCH_TYPES = {
  NORMAL: 'normal',
  RETIRED: 'retired',
  ADMISSION: 'admission',
  ADMISSION_RETIRED: 'admission_retired'
};
const DEFAULT_INSTITUTION = '智狐';
const NORMAL_FIRST_CHOICE_THRESHOLD = 380;
const NORMAL_FIRST_CHOICE_OPTIONS = [
  '常州大学 计算机科学与技术',
  '常州大学 软件工程',
  '苏州科技大学 计算机科学与技术',
  '其他'
];
const VALID_BATCH_TYPES = new Set(Object.values(BATCH_TYPES));
const DEFAULT_SCORE_PAGE_SIZE = 20;
const MAX_SCORE_PAGE_SIZE = 100;

const SCORE_LIMITS_BY_BATCH = {
  [BATCH_TYPES.NORMAL]: {
    highMath: { label: '高数成绩', max: 150 },
    compTheory: { label: '理论成绩', max: 150 },
    compPractical: { label: '实操成绩', max: 80 },
    english: { label: '外语成绩', max: 120 }
  },
  [BATCH_TYPES.RETIRED]: {
    compTheory: { label: '理论成绩', max: 150 }
  },
  [BATCH_TYPES.ADMISSION]: {},
  [BATCH_TYPES.ADMISSION_RETIRED]: {}
};

const NORMAL_ADMISSION_OPTIONS = normalAdmissionOptions;
const RETIRED_ADMISSION_OPTIONS = retiredAdmissionOptions;

const buildAdmissionMajorMap = (options) => new Map(
  options.map(({ school, majors }) => [school, new Set(majors)])
);

const ADMISSION_MAJOR_MAP_BY_BATCH = {
  [BATCH_TYPES.ADMISSION]: buildAdmissionMajorMap(NORMAL_ADMISSION_OPTIONS),
  [BATCH_TYPES.ADMISSION_RETIRED]: buildAdmissionMajorMap(RETIRED_ADMISSION_OPTIONS)
};

const RETIRED_FIRST_CHOICE_SCHOOL_SET = new Set(
  RETIRED_ADMISSION_OPTIONS.map(({ school }) => school)
);

const parseScore = (value) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const parseAdmissionScore = (value) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const hasScoreInput = (value) => (
  value !== undefined
  && value !== null
  && String(value).trim() !== ''
);

const parseNullableScore = (value) => (
  hasScoreInput(value) ? parseScore(value) : null
);

const parseRequiredScore = (value) => {
  if (!hasScoreInput(value)) {
    return null;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseVolunteers = (value) => {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  return [];
};

const normalizeBatchType = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return VALID_BATCH_TYPES.has(normalized) ? normalized : BATCH_TYPES.NORMAL;
};

const isAdmissionBatch = (batchType) => (
  batchType === BATCH_TYPES.ADMISSION
  || batchType === BATCH_TYPES.ADMISSION_RETIRED
);

const isWechatContactBatch = (batchType) => (
  batchType === BATCH_TYPES.RETIRED
  || batchType === BATCH_TYPES.ADMISSION_RETIRED
);

const isContactRequired = () => true;

const isAdminContactRequired = (batchType) => batchType === BATCH_TYPES.ADMISSION_RETIRED;

const sanitizeBatchContact = (batchType, value) => (
  isWechatContactBatch(batchType)
    ? sanitizePlainText(value, 64)
    : sanitizeQQ(value)
);

const sanitizeInstitution = (batchType, value) => {
  if (isAdmissionBatch(batchType) || batchType === BATCH_TYPES.RETIRED) {
    return '';
  }
  const normalized = String(sanitizePlainText(value, 64))
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || DEFAULT_INSTITUTION;
};

const normalizeWhitespace = (value) => String(value || '').replace(/\s+/g, ' ').trim();

const sanitizeOptionalInstitution = (batchType, value) => {
  if (isAdmissionBatch(batchType) || batchType === BATCH_TYPES.RETIRED) {
    return '';
  }

  return normalizeWhitespace(sanitizePlainText(value, 64));
};

const sanitizeAdmissionSchool = (value) => normalizeWhitespace(sanitizePlainText(value, 128));

const sanitizeAdmissionMajor = (value) => normalizeWhitespace(sanitizePlainText(value, 128));

const sanitizeFirstChoice = (value) => normalizeWhitespace(sanitizePlainText(value, 128));

const calculateNormalBatchTotal = ({ highMath, english, compTheory, compPractical }) => (
  parseScore(highMath)
  + parseScore(english)
  + parseScore(compTheory)
  + parseScore(compPractical)
);
const requiresNormalFirstChoice = (totalScore) => totalScore >= NORMAL_FIRST_CHOICE_THRESHOLD;

const sanitizeStoredScreenshotName = (value) => path.basename(String(value || '').trim());

const getScoreScreenshotAbsolutePath = (fileName) => (
  path.join(SCORE_SCREENSHOT_DIR, sanitizeStoredScreenshotName(fileName))
);

const removeScoreScreenshot = async (fileName) => {
  const normalizedFileName = sanitizeStoredScreenshotName(fileName);
  if (!normalizedFileName) {
    return;
  }

  try {
    await fs.promises.rm(getScoreScreenshotAbsolutePath(normalizedFileName), { force: true });
  } catch (error) {
    console.error(`Error deleting score screenshot: ${error.message}`);
  }
};

const getBatchContactLabel = (batchType) => (
  isWechatContactBatch(batchType) ? '微信号' : 'QQ号'
);

const validateScoreLimits = (batchType, { highMath, english, compTheory, compPractical }) => {
  const scoreMap = { highMath, english, compTheory, compPractical };
  const limits = SCORE_LIMITS_BY_BATCH[batchType] || SCORE_LIMITS_BY_BATCH[BATCH_TYPES.NORMAL];

  for (const key of Object.keys(limits)) {
    const { label, max } = limits[key];
    const score = parseScore(scoreMap[key]);
    if (score > max) {
      return `${label}不能大于${max}分，请重新输入`;
    }
  }

  return null;
};

const validateNormalFirstChoice = (batchType, {
  highMath,
  english,
  compTheory,
  compPractical,
  firstChoice
}) => {
  if (batchType !== BATCH_TYPES.NORMAL) {
    return null;
  }

  const totalScore = calculateNormalBatchTotal({
    highMath,
    english,
    compTheory,
    compPractical
  });

  if (requiresNormalFirstChoice(totalScore)) {
    if (!firstChoice) {
      return `总分达到 ${NORMAL_FIRST_CHOICE_THRESHOLD} 分及以上时，请选择一志愿`;
    }

    if (false && !NORMAL_FIRST_CHOICE_SET.has(firstChoice)) {
      return '请从下拉框中选择正确的一志愿';
    }

    return null;
  }

  if (firstChoice) {
    return `总分低于 ${NORMAL_FIRST_CHOICE_THRESHOLD} 分时，不能填写一志愿`;
  }

  return null;
};

const rejectScoreMutation = (res, statusCode, error) => {
  return res.status(statusCode).json({ error });
};

const getAdmissionOptionsForBatch = (batchType) => {
  if (
    batchType === BATCH_TYPES.RETIRED
    || batchType === BATCH_TYPES.ADMISSION_RETIRED
  ) {
    return RETIRED_ADMISSION_OPTIONS;
  }

  return NORMAL_ADMISSION_OPTIONS;
};

const getAdmissionMajorMapForBatch = (batchType) => (
  ADMISSION_MAJOR_MAP_BY_BATCH[batchType] || new Map()
);

const validateRetiredFirstChoice = (batchType, firstChoice) => {
  if (batchType !== BATCH_TYPES.RETIRED) {
    return null;
  }

  if (!firstChoice) {
    return '请选择一志愿院校';
  }

  if (!RETIRED_FIRST_CHOICE_SCHOOL_SET.has(firstChoice)) {
    return '请从下拉候选中选择一志愿院校';
  }

  return null;
};

const validateAdmissionSelection = ({ batchType, school, major, admissionScore }) => {
  if (!school) {
    return '请选择录取院校';
  }

  const validMajors = getAdmissionMajorMapForBatch(batchType).get(school);
  if (!validMajors) {
    return '请选择当前批次提供的录取院校';
  }

  if (!major) {
    return '请选择录取专业';
  }

  if (!validMajors.has(major)) {
    return '所选录取专业不属于该录取院校';
  }

  if (!Number.isFinite(admissionScore) || admissionScore <= 0) {
    return '请填写有效的录取分数';
  }

  return null;
};

const validateAdminTotalScore = (batchType, totalScore) => {
  if (!Number.isFinite(totalScore)) {
    return '总分为必填项';
  }

  if (totalScore < 0) {
    return '总分不能小于0';
  }

  if (batchType === BATCH_TYPES.NORMAL && totalScore > 500) {
    return '总分不能大于500分，请重新输入';
  }

  if (batchType === BATCH_TYPES.RETIRED && totalScore > 150) {
    return '分数不能大于150分，请重新输入';
  }

  return null;
};

const buildScorePayload = (
  batchType,
  {
    highMath,
    english,
    compTheory,
    compPractical,
    firstChoice,
    admissionScore,
    admissionSchool,
    admissionMajor
  }
) => {
  if (batchType === BATCH_TYPES.RETIRED) {
    return {
      highMath: 0,
      english: 0,
      compTheory: parseScore(compTheory),
      compPractical: 0,
      firstChoice,
      admissionSchool: '',
      admissionMajor: '',
      admissionScore: 0
    };
  }

  if (isAdmissionBatch(batchType)) {
    return {
      highMath: 0,
      english: 0,
      compTheory: 0,
      compPractical: 0,
      firstChoice: '',
      admissionSchool,
      admissionMajor,
      admissionScore: admissionScore ?? 0
    };
  }

  return {
    highMath: parseScore(highMath),
    english: parseScore(english),
    compTheory: parseScore(compTheory),
    compPractical: parseScore(compPractical),
    firstChoice,
    admissionSchool: '',
    admissionMajor: '',
    admissionScore: 0
  };
};

const buildAdminScorePayload = (
  batchType,
  {
    highMath,
    english,
    compTheory,
    compPractical,
    firstChoice,
    admissionSchool,
    admissionMajor
  },
  totalScore
) => {
  if (batchType === BATCH_TYPES.RETIRED) {
    return {
      highMath: null,
      english: null,
      compTheory: totalScore,
      compPractical: null,
      firstChoice,
      admissionSchool: '',
      admissionMajor: '',
      admissionScore: 0
    };
  }

  if (isAdmissionBatch(batchType)) {
    return {
      highMath: null,
      english: null,
      compTheory: null,
      compPractical: null,
      firstChoice: '',
      admissionSchool,
      admissionMajor,
      admissionScore: totalScore
    };
  }

  return {
    highMath: parseNullableScore(highMath),
    english: parseNullableScore(english),
    compTheory: parseNullableScore(compTheory),
    compPractical: parseNullableScore(compPractical),
    firstChoice,
    admissionSchool: '',
    admissionMajor: '',
    admissionScore: 0
  };
};

const calculateStoredTotalScore = (
  batchType,
  {
    highMath,
    english,
    compTheory,
    compPractical,
    admissionScore
  }
) => {
  if (batchType === BATCH_TYPES.RETIRED) {
    return parseScore(compTheory);
  }

  if (isAdmissionBatch(batchType)) {
    return parseScore(admissionScore);
  }

  return calculateNormalBatchTotal({
    highMath,
    english,
    compTheory,
    compPractical
  });
};

const calculateTotalScore = (score) => {
  const persistedTotalScore = Number(score?.totalScore);
  if (Number.isFinite(persistedTotalScore)) {
    return persistedTotalScore;
  }
  if (score.batchType === BATCH_TYPES.RETIRED) {
    return score.compTheory;
  }
  if (isAdmissionBatch(score.batchType)) {
    return score.admissionScore;
  }
  return score.highMath + score.english + score.compTheory + score.compPractical;
};

const getScoreOrderBy = (batchType) => (
  batchType === BATCH_TYPES.RETIRED
    ? [{ compTheory: 'desc' }, { id: 'asc' }]
    : [{ totalScore: 'desc' }, { id: 'asc' }]
);

const buildHigherRankWhere = (batchType, score) => {
  const rankField = batchType === BATCH_TYPES.RETIRED ? 'compTheory' : 'totalScore';
  const scoreValue = parseScore(score?.[rankField]);

  return {
    batchType,
    OR: [
      { [rankField]: { gt: scoreValue } },
      { [rankField]: scoreValue, id: { lt: score.id } }
    ]
  };
};

const toPublicScore = (score, { batchType, adminView, myId, rank }) => {
  const isMe = Number.isInteger(myId) && myId === score.id;
  const { scoreScreenshot, editKey, isRecommended, ...publicScore } = score;

  return {
    ...publicScore,
    isRecommended: adminView || isMe ? Boolean(isRecommended) : undefined,
    rank: isAdmissionBatch(batchType) ? undefined : rank,
    name: adminView || isMe ? score.name : maskName(score.name),
    qq: adminView || isMe ? score.qq : undefined,
    canEdit: isMe
  };
};

const normalizeAdmissionStatsBatchType = (value) => {
  const normalized = normalizeBatchType(value);
  if (
    normalized === BATCH_TYPES.RETIRED
    || normalized === BATCH_TYPES.ADMISSION_RETIRED
  ) {
    return BATCH_TYPES.ADMISSION_RETIRED;
  }
  return BATCH_TYPES.ADMISSION;
};

const buildAdmissionStatsKey = (school, major) => `${school}\u0000${major}`;

const createAdmissionStatsEntry = (school, major) => ({
  school,
  major,
  totalCount: 0,
  eligibleCount: 0,
  excludedRecommendedCount: 0,
  minScore: null,
  maxScore: null
});

const applyAdmissionScoreToStatsEntry = (entry, scoreValue) => {
  entry.eligibleCount += 1;
  entry.minScore = entry.minScore === null ? scoreValue : Math.min(entry.minScore, scoreValue);
  entry.maxScore = entry.maxScore === null ? scoreValue : Math.max(entry.maxScore, scoreValue);
};

const buildAdmissionScoreStats = async (batchType) => {
  const normalizedStatsBatch = normalizeAdmissionStatsBatchType(batchType);
  const options = getAdmissionOptionsForBatch(normalizedStatsBatch);
  const entries = new Map();
  const optionKeys = new Set();

  for (const option of options) {
    const school = sanitizeAdmissionSchool(option.school);
    const majors = Array.isArray(option.majors) ? option.majors : [];
    for (const major of majors) {
      const normalizedMajor = sanitizeAdmissionMajor(major);
      const key = buildAdmissionStatsKey(school, normalizedMajor);
      optionKeys.add(key);
      entries.set(key, createAdmissionStatsEntry(school, normalizedMajor));
    }
  }

  const admissionResults = await prisma.studentScore.findMany({
    where: { batchType: normalizedStatsBatch },
    select: {
      admissionSchool: true,
      admissionMajor: true,
      admissionScore: true,
      totalScore: true,
      isRecommended: true
    }
  });

  for (const score of admissionResults) {
    const school = sanitizeAdmissionSchool(score.admissionSchool);
    const major = sanitizeAdmissionMajor(score.admissionMajor);
    if (!school || !major) {
      continue;
    }

    const key = buildAdmissionStatsKey(school, major);
    if (!entries.has(key)) {
      entries.set(key, createAdmissionStatsEntry(school, major));
    }

    const entry = entries.get(key);
    entry.totalCount += 1;

    if (
      normalizedStatsBatch === BATCH_TYPES.ADMISSION
      && score.isRecommended
    ) {
      entry.excludedRecommendedCount += 1;
      continue;
    }

    const scoreValue = parseAdmissionScore(score.admissionScore);
    if (!Number.isFinite(scoreValue) || scoreValue <= 0) {
      continue;
    }

    applyAdmissionScoreToStatsEntry(entry, scoreValue);
  }

  const schools = [];
  for (const option of options) {
    const school = sanitizeAdmissionSchool(option.school);
    const majors = Array.isArray(option.majors) ? option.majors : [];
    schools.push({
      school,
      majors: majors.map((major) => {
        const normalizedMajor = sanitizeAdmissionMajor(major);
        return entries.get(buildAdmissionStatsKey(school, normalizedMajor))
          || createAdmissionStatsEntry(school, normalizedMajor);
      })
    });
  }

  const extraEntries = Array.from(entries.values())
    .filter((entry) => !optionKeys.has(buildAdmissionStatsKey(entry.school, entry.major)));
  const extraSchoolMap = new Map();
  for (const entry of extraEntries) {
    if (!extraSchoolMap.has(entry.school)) {
      extraSchoolMap.set(entry.school, []);
    }
    extraSchoolMap.get(entry.school).push(entry);
  }
  for (const [school, majors] of extraSchoolMap.entries()) {
    schools.push({ school, majors });
  }

  const totals = Array.from(entries.values()).reduce((acc, entry) => ({
    totalCount: acc.totalCount + entry.totalCount,
    eligibleCount: acc.eligibleCount + entry.eligibleCount,
    excludedRecommendedCount: acc.excludedRecommendedCount + entry.excludedRecommendedCount
  }), {
    totalCount: 0,
    eligibleCount: 0,
    excludedRecommendedCount: 0
  });

  return {
    batchType: normalizedStatsBatch,
    updatedAt: new Date().toISOString(),
    totals,
    schools
  };
};

const logServerError = (context, error) => {
  if (error instanceof Error) {
    console.error(`${context}: ${error.message}`);
    return;
  }
  console.error(`${context}: ${String(error)}`);
};

const getScoreSubmitIpNameKey = (clientIp, batchType) =>
  `${clientIp || 'unknown'}:${batchType}`;

const hasTooManyRecentNamesFromIp = (clientIp, batchType, name) => {
  purgeExpiredScoreSubmitState();

  const key = getScoreSubmitIpNameKey(clientIp, batchType);
  const names = scoreSubmitIpNameWindows.get(key);
  if (!names || names.has(name)) {
    return false;
  }

  return names.size >= SCORE_SUBMIT_IP_MAX_NAMES;
};

const recordScoreSubmitIpName = (clientIp, batchType, name) => {
  purgeExpiredScoreSubmitState();

  const key = getScoreSubmitIpNameKey(clientIp, batchType);
  const names = scoreSubmitIpNameWindows.get(key) || new Map();
  names.set(name, Date.now() + SCORE_SUBMIT_IP_NAME_WINDOW_MS);
  scoreSubmitIpNameWindows.set(key, names);
};

const loginFailureState = new Map();
const usedTotpTimeSteps = new Map();

const LOGIN_METHODS = {
  TOTP: 'totp',
  PASSWORD: 'password'
};

const safeEqual = (left, right) => {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const getRequestedLoginMethod = (body) => {
  const requestedMethod = String(body?.method || '').trim().toLowerCase();
  if (requestedMethod === LOGIN_METHODS.PASSWORD) {
    return LOGIN_METHODS.PASSWORD;
  }
  if (requestedMethod === LOGIN_METHODS.TOTP) {
    return LOGIN_METHODS.TOTP;
  }
  if (body?.password !== undefined) {
    return LOGIN_METHODS.PASSWORD;
  }
  return LOGIN_METHODS.TOTP;
};

const getLoginState = (key) => {
  const state = loginFailureState.get(key) || { failedCount: 0, lockUntil: 0 };
  if (state.lockUntil && state.lockUntil <= Date.now()) {
    const reset = { failedCount: 0, lockUntil: 0 };
    loginFailureState.set(key, reset);
    return reset;
  }
  return state;
};

const getLoginKeys = (method, ip) => [
  `${method}:ip:${ip || 'unknown'}`,
  `${method}:global`
];

const getActiveLockSeconds = (keys) => {
  let maxSeconds = 0;
  const now = Date.now();
  keys.forEach((key) => {
    const state = getLoginState(key);
    if (state.lockUntil > now) {
      maxSeconds = Math.max(maxSeconds, Math.ceil((state.lockUntil - now) / 1000));
    }
  });
  return maxSeconds;
};

const recordLoginFailure = (keys) => {
  const now = Date.now();
  let lockSeconds = 0;

  keys.forEach((key) => {
    const state = getLoginState(key);
    state.failedCount += 1;
    if (state.failedCount >= ADMIN_LOGIN_MAX_FAILURES) {
      state.failedCount = 0;
      state.lockUntil = now + ADMIN_LOGIN_LOCK_MS;
    }
    loginFailureState.set(key, state);
    if (state.lockUntil > now) {
      lockSeconds = Math.max(lockSeconds, Math.ceil((state.lockUntil - now) / 1000));
    }
  });

  const primary = getLoginState(keys[0]);
  const remainingAttempts = primary.lockUntil > now
    ? 0
    : Math.max(0, ADMIN_LOGIN_MAX_FAILURES - primary.failedCount);

  return { remainingAttempts, lockSeconds };
};

const clearLoginFailures = (keys) => {
  keys.forEach((key) => loginFailureState.delete(key));
};

const verifyTotpAndConsume = (code) => {
  if (!/^\d{6}$/.test(code)) {
    return { ok: false, error: '动态码格式错误' };
  }

  const verification = speakeasy.totp.verifyDelta({
    secret: ADMIN_TOTP_SECRET,
    encoding: 'base32',
    token: code,
    window: 1,
    step: ADMIN_TOTP_PERIOD
  });

  if (!verification || typeof verification.delta !== 'number') {
    return { ok: false, error: '动态码错误或已过期' };
  }

  const currentStep = Math.floor(nowSeconds() / ADMIN_TOTP_PERIOD) + verification.delta;
  const expiresAt = usedTotpTimeSteps.get(currentStep) || 0;
  if (expiresAt > Date.now()) {
    return { ok: false, error: '该动态码已使用，请等待下一组验证码' };
  }

  usedTotpTimeSteps.set(currentStep, Date.now() + ADMIN_TOTP_PERIOD * 2000);
  return { ok: true };
};

const getTokenFromRequest = (req) => {
  const authHeader = String(req.headers.authorization || '');
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const fromCookie = req.cookies?.[ADMIN_COOKIE_NAME];
  return typeof fromCookie === 'string' ? fromCookie : '';
};

const verifyAdminToken = (token) => {
  if (!token || !ADMIN_JWT_SECRET) {
    return null;
  }
  try {
    const payload = jwt.verify(token, ADMIN_JWT_SECRET);
    if (payload?.role !== 'admin') {
      return null;
    }
    return payload;
  } catch (error) {
    return null;
  }
};

const sessionCookieOptions = (maxAgeMs) => ({
  httpOnly: true,
  secure: ADMIN_COOKIE_SECURE,
  sameSite: ADMIN_COOKIE_SAME_SITE,
  path: '/',
  maxAge: maxAgeMs
});

const clearAdminSessionCookie = (res) => {
  res.clearCookie(ADMIN_COOKIE_NAME, {
    httpOnly: true,
    secure: ADMIN_COOKIE_SECURE,
    sameSite: ADMIN_COOKIE_SAME_SITE,
    path: '/'
  });
};

const issueAdminSession = (res, method) => {
  const sessionId = crypto.randomUUID();
  const token = jwt.sign(
    {
      role: 'admin',
      sid: sessionId,
      method
    },
    ADMIN_JWT_SECRET,
    { expiresIn: ADMIN_TOKEN_TTL }
  );

  const decoded = jwt.decode(token);
  const expiresInSeconds = decoded?.exp ? Math.max(0, decoded.exp - nowSeconds()) : 0;
  const expiresAt = decoded?.exp ? decoded.exp * 1000 : Date.now();
  res.cookie(ADMIN_COOKIE_NAME, token, sessionCookieOptions(expiresInSeconds * 1000));
  return { expiresInSeconds, expiresAt, method };
};

const requireAdminAuth = (req, res, next) => {
  const token = getTokenFromRequest(req);
  if (!token) {
    return res.status(401).json({ error: 'Missing admin session' });
  }
  const payload = verifyAdminToken(token);
  if (!payload) {
    clearAdminSessionCookie(res);
    return res.status(401).json({ error: 'Invalid or expired admin session' });
  }
  req.admin = payload;
  return next();
};

const isAdminRequest = (req) => Boolean(verifyAdminToken(getTokenFromRequest(req)));

const adminRouteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 90,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => getClientIp(req) || 'unknown',
  message: { error: '管理员请求过于频繁，请稍后再试' }
});

const adminLoginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `admin-login:${getClientIp(req) || 'unknown'}`,
  message: { error: '登录尝试过于频繁，请稍后再试' }
});

app.use('/api/admin', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
}, adminRouteLimiter);

const cleanupTransientState = () => {
  const now = Date.now();
  purgeExpiredScoreSubmitState();

  for (const [step, expiresAt] of usedTotpTimeSteps.entries()) {
    if (expiresAt <= now) {
      usedTotpTimeSteps.delete(step);
    }
  }

  for (const [key, state] of loginFailureState.entries()) {
    if ((state.lockUntil && state.lockUntil <= now) && state.failedCount === 0) {
      loginFailureState.delete(key);
    }
  }
};

const cleanupTimer = setInterval(cleanupTransientState, 60 * 1000);
if (typeof cleanupTimer.unref === 'function') {
  cleanupTimer.unref();
}

const handleTotpLogin = (req, res) => {
  if (!ADMIN_JWT_SECRET) {
    return res.status(500).json({ error: 'Admin auth not configured' });
  }
  if (!ADMIN_TOTP_SECRET) {
    return res.status(500).json({ error: '管理员动态码登录未配置' });
  }

  const clientIp = getClientIp(req);
  const keys = getLoginKeys(LOGIN_METHODS.TOTP, clientIp);
  const activeLockSeconds = getActiveLockSeconds(keys);
  if (activeLockSeconds > 0) {
    return res.status(429).json({
      error: `登录已锁定，请在 ${activeLockSeconds} 秒后重试`
    });
  }

  const code = String(req.body?.code || '').replace(/\s+/g, '');
  if (!code) {
    return res.status(400).json({ error: 'Missing code' });
  }

  const verifyResult = verifyTotpAndConsume(code);
  if (!verifyResult.ok) {
    const { remainingAttempts, lockSeconds } = recordLoginFailure(keys);
    if (lockSeconds > 0) {
      return res.status(429).json({ error: `登录已锁定，请在 ${lockSeconds} 秒后重试` });
    }
    return res.status(401).json({
      error: `${verifyResult.error}，剩余尝试次数 ${remainingAttempts}`
    });
  }

  clearLoginFailures(keys);
  const session = issueAdminSession(res, LOGIN_METHODS.TOTP);
  return res.json({
    success: true,
    method: LOGIN_METHODS.TOTP,
    expiresInSeconds: session.expiresInSeconds,
    expiresAt: session.expiresAt
  });
};

const handlePasswordLogin = (req, res) => {
  if (!ADMIN_JWT_SECRET) {
    return res.status(500).json({ error: 'Admin auth not configured' });
  }
  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ error: '管理员密码登录未配置' });
  }

  const clientIp = getClientIp(req);
  const keys = getLoginKeys(LOGIN_METHODS.PASSWORD, clientIp);
  const activeLockSeconds = getActiveLockSeconds(keys);
  if (activeLockSeconds > 0) {
    return res.status(429).json({
      error: `登录已锁定，请在 ${activeLockSeconds} 秒后重试`
    });
  }

  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!password) {
    return res.status(400).json({ error: 'Missing password' });
  }

  if (!safeEqual(password, ADMIN_PASSWORD)) {
    const { remainingAttempts, lockSeconds } = recordLoginFailure(keys);
    if (lockSeconds > 0) {
      return res.status(429).json({ error: `登录已锁定，请在 ${lockSeconds} 秒后重试` });
    }
    return res.status(401).json({
      error: `管理员密码错误，剩余尝试次数 ${remainingAttempts}`
    });
  }

  clearLoginFailures(keys);
  const session = issueAdminSession(res, LOGIN_METHODS.PASSWORD);
  return res.json({
    success: true,
    method: LOGIN_METHODS.PASSWORD,
    expiresInSeconds: session.expiresInSeconds,
    expiresAt: session.expiresAt
  });
};

const handleAdminLogin = (req, res) => {
  const method = getRequestedLoginMethod(req.body);
  if (method === LOGIN_METHODS.PASSWORD) {
    return handlePasswordLogin(req, res);
  }
  return handleTotpLogin(req, res);
};

app.get('/health', (req, res) => {
  res.status(200).send('healthy');
});

app.get('/api/admin/session', async (req, res) => {
  const payload = verifyAdminToken(getTokenFromRequest(req));
  if (!payload) {
    return res.json({
      authenticated: false
    });
  }
  return res.json({
    authenticated: true,
    method: payload.method || LOGIN_METHODS.TOTP,
    expiresAt: payload.exp ? payload.exp * 1000 : null
  });
});

app.get('/api/admin/score-protection', requireAdminAuth, async (req, res) => {
  const enabled = await getScoreProtectionEnabled();
  return res.json({
    enabled,
    blockedIpCount: BLOCKED_SCORE_SUBMIT_IPS.size,
    submitTokenRequired: enabled,
    sameSiteRequired: enabled,
    submitRateLimited: enabled,
    ipNameLimited: enabled
  });
});

app.put('/api/admin/score-protection', requireAdminAuth, async (req, res) => {
  try {
    const enabled = toBoolean(req.body?.enabled, false);
    await setScoreProtectionEnabled(enabled);
    if (!enabled) {
      scoreSubmitTokens.clear();
      scoreSubmitIpNameWindows.clear();
    }

    return res.json({
      success: true,
      enabled
    });
  } catch (error) {
    logServerError('Error updating score protection setting', error);
    return res.status(500).json({ error: '登记防护设置保存失败，请稍后重试' });
  }
});

app.post('/api/admin/login', adminLoginLimiter, handleAdminLogin);
app.post('/api/admin/login/totp', adminLoginLimiter, handleTotpLogin);
app.post('/api/admin/login/password', adminLoginLimiter, handlePasswordLogin);

app.post('/api/admin/logout', (req, res) => {
  clearAdminSessionCookie(res);
  return res.json({ success: true });
});

app.delete('/api/admin/scores/:id', requireAdminAuth, async (req, res) => {
  const id = Number.parseInt(String(req.params.id || ''), 10);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid id' });
  }

  try {
    const existing = await prisma.studentScore.findUnique({
      where: { id },
      select: {
        scoreScreenshot: true
      }
    });

    if (!existing) {
      return res.status(404).json({ error: 'Record not found' });
    }

    await prisma.studentScore.delete({
      where: { id }
    });
    await removeScoreScreenshot(existing.scoreScreenshot);
    io.emit('update_scores');
    return res.json({ success: true });
  } catch (error) {
    logServerError('Error deleting score', error);
    return res.status(500).json({ error: 'Failed to delete score' });
  }
});

app.put('/api/admin/scores/:id', requireAdminAuth, async (req, res) => {
  try {
    const id = Number.parseInt(String(req.params.id || ''), 10);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: '无效的记录编号' });
    }

    const existing = await prisma.studentScore.findUnique({
      where: { id }
    });

    if (!existing) {
      return res.status(404).json({ error: '未找到对应记录' });
    }

    const batchType = normalizeBatchType(existing.batchType);
    const nextHighMath = req.body?.highMath ?? existing.highMath;
    const nextEnglish = req.body?.english ?? existing.english;
    const nextCompTheory = req.body?.compTheory ?? existing.compTheory;
    const nextCompPractical = req.body?.compPractical ?? existing.compPractical;
    const hasManualTotalScore = hasScoreInput(req.body?.totalScore);
    const manualTotalScore = parseRequiredScore(req.body?.totalScore);
    const nextAdmissionScore = req.body?.admissionScore ?? existing.admissionScore;
    const nextAdmissionSchool = sanitizeAdmissionSchool(
      req.body?.admissionSchool ?? existing.admissionSchool
    );
    const nextAdmissionMajor = sanitizeAdmissionMajor(
      req.body?.admissionMajor ?? existing.admissionMajor
    );
    const nextFirstChoice = sanitizeFirstChoice(req.body?.firstChoice ?? existing.firstChoice);
    const hasIsRecommendedInput = Object.prototype.hasOwnProperty.call(req.body || {}, 'isRecommended');
    const nextIsRecommended = batchType === BATCH_TYPES.ADMISSION
      ? (
          hasIsRecommendedInput
            ? parseRequiredBooleanChoice(req.body?.isRecommended)
            : Boolean(existing.isRecommended)
        )
      : false;

    const scoreLimitError = validateScoreLimits(batchType, {
      highMath: nextHighMath,
      english: nextEnglish,
      compTheory: nextCompTheory,
      compPractical: nextCompPractical
    });
    if (scoreLimitError) {
      return res.status(400).json({ error: scoreLimitError });
    }

    if (hasManualTotalScore) {
      const totalScoreError = validateAdminTotalScore(batchType, manualTotalScore);
      if (totalScoreError) {
        return res.status(400).json({ error: totalScoreError });
      }
    }

    if (batchType === BATCH_TYPES.ADMISSION && nextIsRecommended === null) {
      return res.status(400).json({ error: '请选择是否为保送生' });
    }

    const parsedAdmissionScore = parseAdmissionScore(nextAdmissionScore);
    const scorePayload = hasManualTotalScore
      ? buildAdminScorePayload(batchType, {
          highMath: nextHighMath,
          english: nextEnglish,
          compTheory: nextCompTheory,
          compPractical: nextCompPractical,
          firstChoice: nextFirstChoice,
          admissionSchool: nextAdmissionSchool,
          admissionMajor: nextAdmissionMajor
        }, manualTotalScore)
      : buildScorePayload(batchType, {
          highMath: nextHighMath,
          english: nextEnglish,
          compTheory: nextCompTheory,
          compPractical: nextCompPractical,
          firstChoice: nextFirstChoice,
          admissionScore: parsedAdmissionScore,
          admissionSchool: nextAdmissionSchool,
          admissionMajor: nextAdmissionMajor
        });
    const totalScore = hasManualTotalScore
      ? manualTotalScore
      : calculateStoredTotalScore(batchType, scorePayload);

    const updated = await prisma.studentScore.update({
      where: { id },
      data: {
        ...scorePayload,
        totalScore,
        ...(batchType === BATCH_TYPES.ADMISSION ? { isRecommended: nextIsRecommended } : {})
      }
    });

    io.emit('update_scores');
    return res.json({ success: true, data: { id: updated.id } });
  } catch (error) {
    logServerError('Error updating score by admin', error);
    return res.status(500).json({ error: '管理员更新成绩失败，请稍后重试' });
  }
});

app.post('/api/admin/scores', requireAdminAuth, async (req, res) => {
  try {
    const batchType = normalizeBatchType(req.body?.batchType);
    const normalizedName = sanitizePlainText(req.body?.name, 32);
    const normalizedInstitution = sanitizeOptionalInstitution(batchType, req.body?.institution);
    const normalizedQQ = sanitizeBatchContact(batchType, req.body?.qq);
    const normalizedFirstChoice = sanitizeFirstChoice(req.body?.firstChoice);
    const normalizedAdmissionSchool = sanitizeAdmissionSchool(req.body?.admissionSchool);
    const normalizedAdmissionMajor = sanitizeAdmissionMajor(req.body?.admissionMajor);
    const totalScore = parseRequiredScore(req.body?.totalScore);
    const isRecommended = batchType === BATCH_TYPES.ADMISSION
      ? parseOptionalBooleanChoice(req.body?.isRecommended, false)
      : false;

    if (!normalizedName) {
      return rejectScoreMutation(res, 400, '姓名为必填项');
    }

    const totalScoreError = validateAdminTotalScore(batchType, totalScore);
    if (totalScoreError) {
      return rejectScoreMutation(res, 400, totalScoreError);
    }

    if (isAdminContactRequired(batchType) && !normalizedQQ) {
      return rejectScoreMutation(
        res,
        400,
        `${getBatchContactLabel(batchType)}为必填项`
      );
    }

    const scorePayload = buildAdminScorePayload(batchType, {
      highMath: req.body?.highMath,
      english: req.body?.english,
      compTheory: req.body?.compTheory,
      compPractical: req.body?.compPractical,
      firstChoice: normalizedFirstChoice,
      admissionSchool: normalizedAdmissionSchool,
      admissionMajor: normalizedAdmissionMajor
    }, totalScore);

    const scoreLimitError = validateScoreLimits(batchType, scorePayload);
    if (scoreLimitError) {
      return rejectScoreMutation(res, 400, scoreLimitError);
    }

    const existing = await prisma.studentScore.findFirst({
      where: { name: normalizedName, batchType }
    });

    if (existing) {
      return rejectScoreMutation(res, 409, '该姓名在当前批次已登记，不能重复添加');
    }

    if (normalizedQQ) {
      const existingQQ = await prisma.studentScore.findFirst({
        where: { qq: normalizedQQ, batchType }
      });

      if (existingQQ) {
        return rejectScoreMutation(res, 409, `该${getBatchContactLabel(batchType)}在当前批次已登记，不能重复添加`);
      }
    }

    const newScore = await prisma.studentScore.create({
      data: {
        batchType,
        name: normalizedName,
        institution: normalizedInstitution,
        qq: normalizedQQ,
        isRecommended,
        ...scorePayload,
        totalScore,
        scoreScreenshot: '',
        volunteers: JSON.stringify(parseVolunteers(req.body?.volunteers)),
        editKey: ''
      }
    });

    io.emit('update_scores');
    return res.json({ success: true, data: { id: newScore.id, isUpdate: false } });
  } catch (error) {
    logServerError('Error creating score by admin', error);
    return res.status(500).json({ error: '管理员添加记录失败，请稍后重试' });
  }
});

app.get('/api/admin/admission-score-stats', requireAdminAuth, async (req, res) => {
  try {
    const batchType = normalizeAdmissionStatsBatchType(req.query?.batchType);
    const stats = await buildAdmissionScoreStats(batchType);
    return res.json(stats);
  } catch (error) {
    logServerError('Error fetching admission score stats', error);
    return res.status(500).json({ error: '院校分数统计获取失败，请稍后重试' });
  }
});

app.get('/api/admission-options', (req, res) => {
  const batchType = normalizeBatchType(req.query?.batchType);
  return res.json({
    schools: getAdmissionOptionsForBatch(batchType)
  });
});

app.get('/api/scores', async (req, res) => {
  try {
    const myId = Number.parseInt(String(req.query.myId || ''), 10);
    const batchType = normalizeBatchType(req.query.batchType);
    const adminView = toBoolean(req.query.adminView) && isAdminRequest(req);
    const includeAll = toBoolean(req.query.all);
    const requestedPage = toPositiveInt(req.query.page, 1);
    const requestedPageSize = clamp(
      toPositiveInt(req.query.pageSize, DEFAULT_SCORE_PAGE_SIZE),
      1,
      MAX_SCORE_PAGE_SIZE
    );
    const where = { batchType };
    const [totalCount, aggregateResult, myRawRecord] = await Promise.all([
      prisma.studentScore.count({ where }),
      prisma.studentScore.aggregate({
        where,
        _avg: {
          totalScore: true
        }
      }),
      Number.isInteger(myId)
        ? prisma.studentScore.findFirst({
            where: {
              id: myId,
              batchType
            }
          })
        : Promise.resolve(null)
    ]);

    const averageScore = Number.isFinite(aggregateResult?._avg?.totalScore)
      ? Number(aggregateResult._avg.totalScore.toFixed(1))
      : null;
    const totalPages = includeAll ? 1 : Math.max(1, Math.ceil(totalCount / requestedPageSize));
    const page = includeAll ? 1 : clamp(requestedPage, 1, totalPages);
    const pageSize = includeAll ? Math.max(totalCount, 1) : requestedPageSize;
    const offset = includeAll ? 0 : (page - 1) * pageSize;
    const rawScores = await prisma.studentScore.findMany({
      where,
      orderBy: getScoreOrderBy(batchType),
      ...(includeAll ? {} : { skip: offset, take: pageSize })
    });

    const items = rawScores.map((score, index) => toPublicScore(score, {
      batchType,
      adminView,
      myId,
      rank: offset + index + 1
    }));

    let myRecord = null;
    if (myRawRecord) {
      const higherRankCount = isAdmissionBatch(batchType)
        ? null
        : await prisma.studentScore.count({
            where: buildHigherRankWhere(batchType, myRawRecord)
          });

      myRecord = toPublicScore(myRawRecord, {
        batchType,
        adminView,
        myId,
        rank: higherRankCount === null ? undefined : higherRankCount + 1
      });
    }

    return res.json({
      items,
      myRecord,
      stats: {
        totalCount,
        averageScore
      },
      pagination: {
        page,
        pageSize,
        totalItems: totalCount,
        totalPages,
        hasPrevPage: page > 1,
        hasNextPage: page < totalPages
      }
    });
  } catch (error) {
    logServerError('Error fetching scores', error);
    return res.status(500).json({ error: 'Failed to fetch scores' });
  }
});

app.post('/api/scores', async (req, res) => {
  try {
    const {
      highMath,
      english,
      compTheory,
      compPractical,
      firstChoice: rawFirstChoice,
      admissionScore: rawAdmissionScore,
      volunteers,
      batchType: rawBatchType
    } = req.body;
    const batchType = normalizeBatchType(rawBatchType);
    const normalizedName = sanitizePlainText(req.body?.name, 32);
    const normalizedInstitution = sanitizeInstitution(batchType, req.body?.institution);
    const normalizedQQ = sanitizeBatchContact(batchType, req.body?.qq);
    const normalizedFirstChoice = sanitizeFirstChoice(rawFirstChoice);
    const normalizedAdmissionSchool = sanitizeAdmissionSchool(req.body?.admissionSchool);
    const normalizedAdmissionMajor = sanitizeAdmissionMajor(req.body?.admissionMajor);
    const parsedAdmissionScore = parseAdmissionScore(rawAdmissionScore);
    const normalizedVolunteers = parseVolunteers(volunteers);
    const parsedIsRecommended = batchType === BATCH_TYPES.ADMISSION
      ? parseRequiredBooleanChoice(req.body?.isRecommended)
      : false;
    const scoreLimitError = validateScoreLimits(batchType, {
      highMath,
      english,
      compTheory,
      compPractical
    });
    const firstChoiceError = validateNormalFirstChoice(batchType, {
      highMath,
      english,
      compTheory,
      compPractical,
      firstChoice: normalizedFirstChoice
    });
    const retiredFirstChoiceError = validateRetiredFirstChoice(batchType, normalizedFirstChoice);
    const admissionError = isAdmissionBatch(batchType)
      ? validateAdmissionSelection({
          batchType,
          school: normalizedAdmissionSchool,
          major: normalizedAdmissionMajor,
          admissionScore: parsedAdmissionScore
        })
      : null;
    const scorePayload = buildScorePayload(batchType, {
      highMath,
      english,
      compTheory,
      compPractical,
      firstChoice: normalizedFirstChoice,
      admissionScore: parsedAdmissionScore,
      admissionSchool: normalizedAdmissionSchool,
      admissionMajor: normalizedAdmissionMajor
    });
    const totalScore = calculateStoredTotalScore(batchType, scorePayload);

    if (!normalizedName) {
      return rejectScoreMutation(res, 400, '姓名为必填项');
    }

    if (!isAdmissionBatch(batchType) && batchType !== BATCH_TYPES.RETIRED && !normalizedInstitution) {
      return rejectScoreMutation(res, 400, '机构为必填项');
    }

    if (batchType === BATCH_TYPES.ADMISSION && parsedIsRecommended === null) {
      return rejectScoreMutation(res, 400, '请选择是否为保送生');
    }

    if (false) {
      return rejectScoreMutation(res, 400, '修改密码为必填项');
    }

    if (isContactRequired(batchType) && !normalizedQQ) {
      return rejectScoreMutation(
        res,
        400,
        `${getBatchContactLabel(batchType)}为必填项`
      );
    }

    if (scoreLimitError) {
      return rejectScoreMutation(res, 400, scoreLimitError);
    }

    if (firstChoiceError) {
      return rejectScoreMutation(res, 400, firstChoiceError);
    }

    if (retiredFirstChoiceError) {
      return rejectScoreMutation(res, 400, retiredFirstChoiceError);
    }

    if (admissionError) {
      return rejectScoreMutation(res, 400, admissionError);
    }

    const existing = await prisma.studentScore.findFirst({
      where: { name: normalizedName, batchType }
    });

    if (existing) {
      return rejectScoreMutation(
        res,
        409,
        '该姓名在当前批次已登记，不能重复提交。如需修改请联系管理员。'
      );
    }

    const existingQQ = normalizedQQ
      ? await prisma.studentScore.findFirst({
          where: { qq: normalizedQQ, batchType }
        })
      : null;

    if (existingQQ) {
      return rejectScoreMutation(
        res,
        409,
        `该${getBatchContactLabel(batchType)}在当前批次已登记，不能重复提交。如需修改请联系管理员。`
      );
    }

    const clientIp = getClientIp(req);
    const scoreProtectionEnabled = await getScoreProtectionEnabled();
    if (
      scoreProtectionEnabled
      && hasTooManyRecentNamesFromIp(clientIp, batchType, normalizedName)
    ) {
      console.warn(
        `Blocked score submit with too many names from ${clientIp || 'unknown'} in ${batchType}`
      );
      return rejectScoreMutation(
        res,
        429,
        '当前网络短时间内登记人数过多，请稍后再试或联系管理员'
      );
    }

    const newScore = await prisma.studentScore.create({
      data: {
        batchType,
        name: normalizedName,
        institution: isAdmissionBatch(batchType) || batchType === BATCH_TYPES.RETIRED ? '' : normalizedInstitution,
        qq: normalizedQQ,
        isRecommended: batchType === BATCH_TYPES.ADMISSION ? parsedIsRecommended : false,
        ...scorePayload,
        totalScore,
        scoreScreenshot: '',
        volunteers: JSON.stringify(normalizedVolunteers),
        editKey: ''
      }
    });

    if (scoreProtectionEnabled) {
      recordScoreSubmitIpName(clientIp, batchType, normalizedName);
    }
    io.emit('update_scores');
    return res.json({ success: true, data: { id: newScore.id, isUpdate: false } });
  } catch (error) {
    logServerError('Error creating score', error);
    return res.status(500).json({ error: '提交失败，请稍后重试' });
  }
});

app.put('/api/scores/:id', (req, res) => {
  return res.status(403).json({ error: '学生端不支持二次修改成绩，请联系管理员处理' });
});

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);
  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
  });
});

// 生产模式：serve 前端静态文件
if (isProd) {
  const clientDistPath = path.join(__dirname, '..', 'client', 'dist');
  app.use(express.static(clientDistPath));
  // SPA fallback：所有非 API 请求返回 index.html
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith(SOCKET_IO_PATH)) {
      return next();
    }
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
