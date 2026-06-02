# 分数线登记项目 1:1 复刻完整 Prompt

> 使用方式：把本文档整体发给另一个 AI，让它按这里的产品、交互、数据、接口、权限、部署要求实现。目标不是做一个相似页面，而是复刻当前项目的功能行为、字段约束、管理逻辑、刷新机制和部署形态。

## 给 AI 的完整任务

你是一名资深全栈工程师，请从零实现一个名为 **Fenshu / 分数线登记** 的 Web 项目。它是一个用于学生登记成绩、登记录取结果、实时展示排行榜，并提供管理员维护入口的系统。请严格按以下规格实现，要求功能、字段、校验、排序、权限、视觉结构、接口路径和部署方式尽量 1:1 对齐。

## 技术栈

- 前端：React 18 + Vite 5 + Tailwind CSS。
- 前端依赖：`axios`、`socket.io-client`、`lucide-react`、`clsx`、`xlsx`。
- 后端：Node.js 18 + Express 5。
- 后端依赖：`@prisma/client`、`prisma`、`cors`、`helmet`、`cookie-parser`、`express-rate-limit`、`jsonwebtoken`、`speakeasy`、`socket.io`。
- 数据库：SQLite，通过 Prisma ORM 管理。
- 实时更新：Socket.IO。
- 部署：Docker Compose，前端 Nginx 容器 + 后端 Node 容器，后端使用 SQLite Docker 卷持久化。

## 项目路径和运行约定

- 生产访问路径前缀固定为 `/fenshu`。
- 前端 Vite `base` 必须设置为 `/fenshu/`。
- 前端生产环境 API 基础路径为 `/fenshu/api`。
- 前端开发环境 API 基础路径为 `http://localhost:3001/api`。
- 前端生产环境 Socket 地址为 `window.location.origin`，Socket path 为 `/fenshu/socket.io`。
- 前端开发环境 Socket 地址为 `http://localhost:3001`，Socket path 为 `/socket.io`。
- 管理员隐藏入口为 `/fenshu/admin-2026`。
- 后端实际 API 路由都挂在 `/api/*`。
- 后端生产端口为 `3000`，开发可用 `3001` 以配合前端默认配置。

## 前端页面总览

系统只有一个 React 单页应用，但根据当前路径和选择的批次展示不同状态。

### 1. 批次选择页

当用户未选择批次时，展示居中的批次选择卡片：

- 页面背景：浅灰色 `bg-gray-50`。
- 卡片：白底、圆角、浅阴影、边框。
- 标题：`实时登记系统`，左侧使用 `Activity` 图标，蓝色。
- 批次按钮使用浅灰分段容器，按钮文案为：
  - `成绩登记（普通批次）`
  - `成绩登记（退役批次）`
  - `录取结果（普通批次）`
  - `录取结果（退役批次）`
- 点击批次后进入主界面，并把批次存入 `localStorage.selectedBatchType`。

### 2. 主界面顶部

主界面最大宽度 `max-w-7xl`，浅灰背景，内容纵向间距。

顶部卡片包含：

- 批次切换分段按钮，移动端 2 列网格，桌面端 inline-flex。
- 标题区：
  - 普通/退役成绩批次标题：`实时分数线登记系统`
  - 录取批次标题：`录取结果登记系统`
  - 副标题：`当前为 {批次label}，共有 {totalCount} 位同学登记（{rankHint}）`
  - 联系文案：`反馈/联系vx: zhangzh930`，左侧 `MessageCircle` 小图标。
- 管理员模式下显示红色胶囊提示：`管理员模式（可添加、修改、删除记录）`。
- 管理员模式下顶部中间有姓名搜索框，左侧 `Search` 图标，按钮文案 `定位` / `搜索中`。
- 管理员模式右侧按钮：
  - `最低/最高分`，`BarChart3` 图标。
  - `登记防护：开/关`，`Shield` 图标。
  - `下载Excel`，`Download` 图标。
  - `退出管理员`。
- 学生模式右侧：
  - 如果当前批次没有本地已登记记录，显示蓝色按钮 `立即登记`。
  - 如果本地已登记，显示 `欢迎回来, {姓名}` 和黄底提示 `已完成登记，如需修改请联系管理员`。

### 3. 学生端招生宣传条

只在非管理员页面显示。

- 横向渐变背景：`from-indigo-500 to-purple-600`。
- 左侧 `Zap` 图标，黄色。
- 主文案：`27&28届智狐科技计算机/高数全程班 火热招生中！`
- 旁边有 `HOT` 黄色小标签。
- 副文案：`985硕士授课 · 重点押题 · 全程答疑 · 助你一战上岸！`
- 右侧按钮：`立即咨询`。
- 点击后打开咨询二维码弹窗。

### 4. 咨询二维码弹窗

只在学生端显示。

- 黑色半透明遮罩。
- 白色居中弹窗，最大宽度 `max-w-sm`。
- 右上角关闭按钮，`X` 图标。
- 标题：`扫码咨询课程`。
- 文案：`添加好友请备注“咨询课程”`。
- 显示本地图片 `src/wechat_qr.png`，尺寸约 192x192，外层浅灰虚线边框。

## 批次定义

系统共有 4 个批次，内部值必须如下：

```js
{
  NORMAL: 'normal',
  RETIRED: 'retired',
  ADMISSION: 'admission',
  ADMISSION_RETIRED: 'admission_retired'
}
```

批次元信息：

| batchType | label | title | rankHint |
| --- | --- | --- | --- |
| `normal` | `成绩登记（普通批次）` | `实时分数线登记系统` | `按总分从高到低排列` |
| `retired` | `成绩登记（退役批次）` | `实时分数线登记系统` | `按分数从高到低排列` |
| `admission` | `录取结果（普通批次）` | `录取结果登记系统` | `按录取分数从高到低排列` |
| `admission_retired` | `录取结果（退役批次）` | `录取结果登记系统` | `按录取分数从高到低排列` |

## 本地存储规则

- 当前选择批次：`localStorage.selectedBatchType`。
- 每个批次的当前用户缓存：`localStorage.fenshu_user_${batchType}`，JSON 格式：

```json
{
  "id": 1,
  "name": "张三"
}
```

- 普通批次兼容旧缓存：
  - `localStorage.myId`
  - `localStorage.myName`
- 登记成功后写入当前批次缓存。
- 学生端根据 `myId + batchType` 拉取 `myRecord`，如果存在则认为当前批次已完成登记。
- 学生端不允许二次修改，按钮和提交逻辑都要阻止二次提交。

## 学生端登记表单

所有学生端提交都必须：

- 先请求 `GET /api/score-submit-token`。
- 再 `POST /api/scores`，请求头带 `X-Score-Submit-Token: <token>`。
- 成功后弹窗 `登记成功！`。
- 成功后刷新列表并关闭表单。
- 如果失败，展示后端 `error/message`，网络错误展示 `网络异常，请稍后重试`。

### 普通成绩批次 `normal`

字段：

- 姓名：必填，真实姓名。
- 机构：
  - 默认选项为 `智狐`。
  - 下拉额外选项 `自定义`。
  - 选择自定义后出现机构输入框，必填。
- QQ 联系方式：
  - 必填。
  - 只允许数字输入。
  - 前端输入时自动去除非数字。
  - HTML pattern 可用 `[1-9][0-9]{4,14}`。
- 高数成绩：
  - number，step `0.5`，min `0`，max `150`。
  - 可空，空按 0 计算。
- 外语成绩（折算后）：
  - number，step `0.5`，min `0`，max `120`。
  - placeholder：`请填写折算后的分数`。
  - 可空，空按 0 计算。
- 理论成绩：
  - number，step `0.5`，min `0`，max `150`。
  - 可空，空按 0 计算。
- 实操成绩：
  - number，step `0.5`，min `0`，max `80`。
  - 可空，空按 0 计算。
- 当前总分：
  - 实时计算：高数 + 外语 + 理论 + 实操。
  - 显示在蓝色提示卡中。
- 一志愿：
  - 阈值：`380` 分。
  - 总分低于 380 时禁用，并清空一志愿。
  - 总分达到 380 及以上时必填。
  - 下拉选项：
    - `常州大学 计算机科学与技术`
    - `常州大学 软件工程`
    - `苏州科技大学 计算机科学与技术`
    - `其他`
  - 辅助文案：`低于 380 分时禁止填写。`

普通批次提交到后端时：

- `batchType = 'normal'`
- `institution` 为机构名称。
- `qq` 为纯数字。
- `firstChoice` 只有总分 >= 380 时传入，否则为空字符串。
- `admissionScore/admissionSchool/admissionMajor` 均为空或 0。
- `volunteers` 固定为空数组。

### 退役成绩批次 `retired`

字段：

- 姓名：必填。
- 微信号：必填，文本输入，不做纯数字限制。
- 分数：
  - 对应后端字段 `compTheory`。
  - number，step `0.5`，min `0`，max `150`。
  - 必填。
- 一志愿：
  - 必填。
  - 使用可搜索下拉框。
  - 来源为退役批次院校列表，只选择学校，不选择专业。
  - 输入框 placeholder：`输入院校关键词搜索，例如：常州`。
  - 只能从候选院校中选择，不能自定义。

退役成绩批次提交到后端时：

- `batchType = 'retired'`
- `institution = ''`
- `qq` 保存微信号。
- `highMath = 0`
- `english = 0`
- `compPractical = 0`
- `compTheory = 分数`
- `firstChoice = 候选学校`
- `admissionScore/admissionSchool/admissionMajor` 均为空或 0。

### 普通录取结果批次 `admission`

字段：

- 姓名：必填。
- QQ号：必填，纯数字。
- 录取分数：
  - number，step `0.5`，min `0`。
  - 必填，必须大于 0。
- 是否为保送生：
  - 必填。
  - select：空值 `请选择`、`否`、`是`。
  - 前端提交时转为布尔：`yes => true`，`no => false`。
- 录取院校：
  - 可搜索下拉框。
  - 来源为普通录取院校与专业列表。
  - 输入学校关键词筛选，最多显示 20 条。
  - 必须从候选院校中选择，不能自定义。
  - 选择学校后，如果该学校只有一个专业，自动选中该专业；否则清空专业等待选择。
  - 辅助文案：`只能从文档提供的院校中选择，不能自定义输入`。
- 录取专业：
  - select。
  - 未选择院校前禁用，文案 `请先选择录取院校`。
  - 选择院校后展示该院校专业，默认文案 `请选择录取专业`。

普通录取提交到后端时：

- `batchType = 'admission'`
- `institution = ''`
- `highMath/english/compTheory/compPractical = 0`
- `firstChoice = ''`
- `admissionScore = 录取分数`
- `admissionSchool = 候选院校`
- `admissionMajor = 候选专业`
- `isRecommended = 是否保送生`

### 退役录取结果批次 `admission_retired`

字段：

- 姓名：必填。
- 微信号：必填。
- 录取分数：必填，大于 0。
- 录取院校：可搜索下拉，来源为退役录取院校与专业列表。
- 录取专业：来源于所选院校。
- 不显示“是否保送生”。

提交规则同普通录取，但：

- `batchType = 'admission_retired'`
- `qq` 保存微信号。
- `isRecommended = false`

## 排行榜/列表展示

列表是主页面底部的白色卡片表格。

### 通用规则

- 表格横向可滚动。
- 非录取批次显示排名列，录取批次不显示排名列。
- 排名列和姓名列 sticky 固定在左侧。
- 排名列宽 72px。
- 姓名列宽 120px。
- 当前用户自己的记录高亮蓝底，并在姓名旁显示小标签 `我`。
- 管理员搜索命中的行高亮 amber，并滚动到视图中央。
- 空数据时显示：`暂无数据，快来抢占沙发！`

### 隐私规则

学生视图：

- 只能看到自己的完整姓名和联系方式。
- 其他人的姓名脱敏：保留第一个字，其余字符变成 `*`。
- 不展示其他人的 QQ/微信。

管理员视图：

- 展示完整姓名。
- 展示 QQ/微信。
- 展示是否保送生等管理员字段。

### 排序和排名

- `normal`：按 `totalScore desc, id asc` 排序，显示排名。
- `retired`：按 `compTheory desc, id asc` 排序，显示排名。
- `admission`：按 `totalScore desc, id asc` 排序，不显示排名。
- `admission_retired`：按 `totalScore desc, id asc` 排序，不显示排名。
- 非录取批次的 `myRecord.rank` 需要按全量数据计算，不受当前页影响。

### 表格列

普通成绩批次：

- 排名
- 姓名
- 管理员视图额外：QQ号
- 机构
- 高数成绩
- 外语成绩
- 理论成绩
- 实操成绩
- 总分
- 一志愿
- 管理员视图额外：操作

退役成绩批次：

- 排名
- 姓名
- 管理员视图额外：微信号
- 分数
- 一志愿
- 管理员视图额外：操作

普通录取结果批次：

- 姓名
- 管理员视图额外：QQ号
- 录取分数
- 管理员视图额外：是否保送生
- 录取院校
- 录取专业
- 管理员视图额外：操作

退役录取结果批次：

- 姓名
- 管理员视图额外：微信号
- 录取分数
- 录取院校
- 录取专业
- 管理员视图额外：操作

### 分页

- 默认每页 20 条。
- 可选每页：10、20、50、100。
- 分页信息：`共 {totalItems} 条记录`、`第 {page} / {totalPages} 页`。
- 按钮：`上一页`、页码按钮、`下一页`。
- 页码最多显示 5 个，围绕当前页。
- 切换每页条数后回到第 1 页。

### 实时刷新

- 页面每 5 秒自动请求一次列表。
- Socket.IO 监听 `update_scores`。
- 收到 socket 更新后 debounce 1 秒再刷新列表。
- 管理员打开录取统计弹窗时，socket 更新也刷新统计数据。

## 管理员系统

### 管理员入口

- 隐藏入口：`/fenshu/admin-2026`。
- 非该路径不显示管理员入口按钮。
- 进入管理员路径后，如果未登录，只显示居中的管理员登录卡片。
- 登录卡片：
  - 标题：`管理员登录`，左侧 `Shield` 图标。
  - password 输入框 placeholder：`请输入管理员密码`。
  - 按钮：`登录`。
  - 管理员页面登录卡片不显示取消按钮。

### 管理员认证

后端必须支持：

- 管理员密码登录。
- TOTP 动态验证码登录。
- JWT session。
- httpOnly Cookie session。
- Authorization Bearer token 兼容。

当前前端 UI 只使用密码登录：

```json
POST /api/admin/login
{
  "method": "password",
  "password": "管理员密码"
}
```

登录成功响应：

```json
{
  "success": true,
  "method": "password",
  "expiresInSeconds": 900,
  "expiresAt": 1710000000000
}
```

后端通过 cookie `fenshu_admin_session` 写入 JWT，cookie 要求：

- `httpOnly: true`
- `secure` 来自环境变量，生产默认 true，可配置。
- `sameSite` 支持 `strict/lax/none`，默认 `strict`。
- `path: '/'`

管理员会话检测：

```http
GET /api/admin/session
```

响应：

```json
{
  "authenticated": true,
  "method": "password",
  "expiresAt": 1710000000000
}
```

未登录响应：

```json
{
  "authenticated": false
}
```

### 登录安全

- 管理员登录接口 1 分钟最多 10 次。
- 每种登录方式分别维护失败状态。
- 同 IP 和全局两套 key 都计数。
- 默认失败 5 次锁定 15 分钟。
- 环境变量可配置：
  - `ADMIN_LOGIN_MAX_FAILURES`，范围 3-10，默认 5。
  - `ADMIN_LOGIN_LOCK_MINUTES`，范围 5-60，默认 15。
- TOTP：
  - 6 位数字。
  - 默认 period 30 秒，可配置 30-60。
  - `window: 1`。
  - 同一时间步验证码使用后要记录，防重放。
- 密码比较必须使用 timing-safe 比较。

### 管理员顶部能力

管理员登录后：

- 顶部显示管理员模式红色提示。
- 可搜索学生姓名定位。
- 可添加记录。
- 可删除记录。
- 可编辑普通成绩/退役成绩，录取批次 UI 不提供编辑，只可删除。
- 可导出当前批次 Excel。
- 可开关登记防护。
- 可查看录取院校最低/最高分统计。
- 可退出管理员。

### 管理员添加记录

添加记录卡片只在管理员视图显示。

标题：`添加记录`，左侧 `Plus` 图标。右上提交按钮：`保存记录` / `添加中...`，左侧 `Save` 图标。

通用字段：

- 姓名：必填。
- 总分/分数/录取分数：
  - label 按批次变化：
    - normal：`总分`，max 500。
    - retired：`分数`，max 150。
    - admission/admission_retired：`录取分数`，不设置 max。
  - 必填，number，step `0.5`，min `0`。
- 联系方式：
  - 普通成绩、普通录取：QQ号，纯数字。
  - 退役成绩、退役录取：微信号，文本。

普通成绩批次额外：

- 机构：文本输入。
- 高数成绩、外语成绩、理论成绩、实操成绩：可选，用于补充展示。
- 一志愿：select，选项同普通学生端，默认 `未填写`。

退役成绩批次额外：

- 一志愿：select，候选为退役院校列表，默认 `未填写`。

普通录取批次额外：

- 是否保送生：select，`否`/`是`，默认 `否`。
- 录取院校：文本输入。
- 录取专业：文本输入。
- 注意：管理员添加录取记录时允许手输院校/专业，不强制从候选列表选择；统计弹窗要能展示候选列表外的额外院校/专业。

退役录取批次额外：

- 录取院校：文本输入。
- 录取专业：文本输入。

管理员添加后：

- 成功提示 `添加成功`。
- 清空添加表单。
- 回到第 1 页并刷新。
- 后端要阻止当前批次内姓名重复。
- 如果联系方式非空，也要阻止当前批次内联系方式重复。

### 管理员搜索定位

- 输入学生姓名关键字。
- 点击 `定位`。
- 前端请求当前批次全量数据 `GET /api/scores?all=1&adminView=1`。
- 在前端用 `score.name.includes(keyword)` 查找第一条。
- 找到后：
  - 计算目标页：`Math.floor(index / pageSize) + 1`。
  - 设置当前页。
  - 刷新该页。
  - 高亮目标行。
  - 滚动到目标行。
  - 状态文案：`已定位：{姓名}（第 {targetPage} 页，第 {index+1} 条）`。
- 未找到：
  - 状态文案和 alert：`未找到姓名包含“{keyword}”的记录`。

### 管理员编辑记录

仅非录取批次显示编辑按钮。

普通成绩批次可编辑：

- 高数成绩
- 外语成绩
- 理论成绩
- 实操成绩
- 总分
- 一志愿

退役成绩批次可编辑：

- 分数，即 `totalScore`。

编辑按钮：

- 未编辑状态：`Edit2` 图标，title `修改成绩`。
- 编辑状态：
  - 保存：`Save` 图标，title `保存修改`。
  - 取消：`X` 图标，title `取消修改`。

保存前：

- 前端校验分数上限。
- 总分/分数必须有效且不小于 0。
- normal 总分 max 500。
- retired 分数 max 150。
- 收集变更字段，弹出确认框：

```text
确认保存 {姓名} 的成绩修改吗？

高数成绩：原值 -> 新值
...
```

- 没有变更时 alert：`当前没有可保存的修改`。
- 保存成功 alert：`修改成功`，退出编辑并刷新。

### 管理员删除

- 操作列始终显示删除按钮 `Trash2`。
- 点击先 confirm：`确定要删除这条记录吗？`
- 调用 `DELETE /api/admin/scores/:id`。
- 成功 alert：`删除成功`。
- 删除后刷新列表。
- 后端删除记录后如果存在 `scoreScreenshot` 文件，也要删除对应文件。

### 管理员 Excel 导出

按钮：`下载Excel`。

导出逻辑：

- 只允许管理员。
- 请求当前批次全量数据。
- 如果无数据，alert：`当前没有可导出的登记数据`。
- 使用 `xlsx` 动态导入。
- 文件名时间格式：`YYYYMMDD_HHMM`。

录取批次导出列：

- 姓名
- QQ号/微信号
- 普通录取额外：是否保送生，值为 `是`/`否`
- 录取分数
- 录取院校
- 录取专业

录取批次文件名：

```text
录取结果登记_{YYYYMMDD_HHMM}.xlsx
```

普通成绩导出列：

- 姓名
- 机构
- QQ号
- 高数成绩
- 外语成绩
- 理论成绩
- 实操成绩
- 总分
- 一志愿

退役成绩导出列：

- 姓名
- 微信号
- 分数
- 一志愿

成绩批次文件名：

```text
分数线排行榜_{当前批次label}_{YYYYMMDD_HHMM}.xlsx
```

### 登记防护开关

管理员可开关学生端提交防护。

设置存储在数据库 `AppSetting`：

- key：`score_submit_protection_enabled`
- value：`true` / `false`

打开确认文案：

```text
开启后将启用提交令牌、来源校验、IP 黑名单、提交频率和同 IP 多姓名限制。确认开启吗？
```

关闭确认文案：

```text
关闭后学生端登记不再使用 IP/填写防护限制，只保留页面 5 秒自动刷新。确认关闭吗？
```

状态文案：

- `登记防护已开启`
- `登记防护已关闭`
- 读取失败：`登记防护状态读取失败`

防护开启后后端应启用：

- IP 黑名单：来自 `BLOCKED_SCORE_SUBMIT_IPS`，逗号分隔。
- 同源/来源校验：Origin 或 Referer origin 必须在允许列表中。
- 提交 token：
  - `GET /api/score-submit-token` 生成一次性 token。
  - token 绑定 IP 和 User-Agent。
  - 默认有效期 300 秒，可配置 60-1800。
  - POST 使用后立即删除。
- token 请求限流：
  - 默认每 IP 每分钟 20 次，可配置 5-60。
- 提交限流：
  - 每 IP 每分钟 8 次。
- 同 IP 多姓名限制：
  - 默认 600 秒窗口内同 IP 同批次最多登记 3 个不同姓名。
  - 可配置窗口 60-3600 秒、姓名数 1-10。
- 关闭防护时清空内存中的 token 和 IP 姓名窗口。

### 录取院校最低/最高分统计

管理员点击 `最低/最高分` 打开全屏 modal。

弹窗结构：

- 黑色透明遮罩。
- 白色大弹窗，`max-w-7xl`，高度占满。
- 标题：`院校最低/最高分统计`，左侧 `BarChart3` 图标。
- 说明：`当前统计 {普通批次/退役批次} 录取结果，最低分和最高分只计算正常考生。`
- 右上按钮：
  - `刷新`，`RefreshCw` 图标，加载时旋转。
  - `关闭`，`X` 图标。
- 批次切换分段按钮：
  - `普通批次`
  - `退役批次`
- 顶部统计三格：
  - `录取登记`：totalCount
  - `有效统计`：eligibleCount
  - `已排除保送`：excludedRecommendedCount
- 表格列：
  - 院校
  - 专业
  - 最低分
  - 最高分
  - 有效人数
  - 登记人数
  - 排除保送
- 空状态：
  - 加载中：`统计数据加载中...`
  - 无数据：`暂无可统计的院校数据`
- 底部说明：
  - `数据每 5 秒自动刷新；普通批次最低/最高分会排除录取结果中标记为保送生的学生。`

统计规则：

- 普通统计读取 `batchType = admission`。
- 退役统计读取 `batchType = admission_retired`。
- 先按当前批次候选院校/专业列表生成所有条目，即使没有登记也显示。
- 再读取数据库录取结果。
- key 为 `school + '\0' + major`。
- 每条记录累加 `totalCount`。
- 普通录取批次中 `isRecommended = true` 的记录：
  - 计入 totalCount。
  - 计入 excludedRecommendedCount。
  - 不计入 eligibleCount、minScore、maxScore。
- 退役录取不排除保送。
- 录取分数无效或 <=0 不计入 eligible。
- 候选列表之外的管理员手输院校/专业也要作为额外条目追加显示。

## 后端数据模型

使用 Prisma SQLite。Schema 必须包含：

```prisma
model StudentScore {
  id              Int      @id @default(autoincrement())
  batchType       String   @default("normal")
  name            String
  institution     String   @default("")
  qq              String   @default("")
  highMath        Float?
  english         Float?
  compTheory      Float?
  compPractical   Float?
  totalScore      Float    @default(0)
  isRecommended   Boolean  @default(false)
  firstChoice     String   @default("")
  scoreScreenshot String   @default("")
  admissionSchool String   @default("")
  admissionMajor  String   @default("")
  admissionScore  Float    @default(0)
  volunteers      String
  editKey         String   @default("")
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([batchType, totalScore, id])
  @@index([batchType, compTheory, id])
}

model AppSetting {
  key       String   @id
  value     String
  updatedAt DateTime @updatedAt
}
```

字段说明：

- `batchType` 区分四个批次。
- `name` 是学生姓名。
- `institution` 仅普通成绩批次使用，默认 `智狐`。
- `qq` 同时保存 QQ 或微信，具体取决于批次。
- `highMath/english/compTheory/compPractical` 用于普通成绩；退役分数存 `compTheory`。
- `totalScore` 是排序和统计主字段，所有批次都维护。
- `isRecommended` 仅普通录取批次使用，表示保送生。
- `firstChoice` 用于普通成绩达到 380 分后的一志愿，以及退役成绩批次的一志愿院校。
- `scoreScreenshot` 保留字段，当前 UI 不提供上传，但删除记录时要兼容删除文件。
- `admissionSchool/admissionMajor/admissionScore` 用于录取结果批次。
- `volunteers` 为历史兼容字段，JSON 字符串，当前学生提交固定为 `[]`。
- `editKey` 是废弃字段，仅保留兼容。

## 后端通用处理

### 安全与中间件

- `app.set('trust proxy', 1)`。
- CORS：
  - 允许 origin 来自环境变量 `CORS_ALLOW_ORIGINS`，逗号分隔。
  - 默认 `http://localhost:5173,http://localhost:4173`。
  - 如果列表为空，允许全部。
  - `credentials: true`。
  - methods：GET、POST、PUT、DELETE、OPTIONS。
- Helmet：
  - 关闭 CSP：`contentSecurityPolicy: false`。
  - `crossOriginResourcePolicy: { policy: 'cross-origin' }`。
- JSON body limit：`200kb`。
- 管理员接口统一 `Cache-Control: no-store`。
- 管理员接口统一 1 分钟 90 次限流。

### 字段清洗

- 普通文本清洗：
  - 转字符串。
  - 去除 `<`、`>`、控制字符。
  - trim。
  - 按最大长度截断。
- 姓名最大 32。
- 机构最大 64。
- 微信最大 64。
- 院校、专业、一志愿最大 128。
- QQ：
  - 去除非数字。
  - 最大 15 位。
- `normalizeBatchType`：
  - 只接受四个 batchType。
  - 无效值回退 `normal`。

### 分数计算

- 普通成绩总分：`highMath + english + compTheory + compPractical`。
- 退役成绩总分：`compTheory`。
- 录取批次总分：`admissionScore`。
- 管理员手动传 `totalScore` 时，以手动总分为准。
- 数字解析：
  - 必填分数无效返回 null。
  - 非必填分数空值可保存 null 或按业务转换为 0。

## API 规格

### 健康检查

```http
GET /health
```

响应文本：

```text
healthy
```

### 获取院校专业选项

```http
GET /api/admission-options?batchType=normal
```

规则：

- `batchType=retired` 或 `admission_retired` 返回退役录取选项。
- 其他返回普通录取选项。

响应：

```json
{
  "schools": [
    {
      "school": "南京工程学院",
      "majors": ["软件工程"]
    }
  ]
}
```

### 获取成绩/录取列表

```http
GET /api/scores
```

查询参数：

- `batchType`：四个批次之一。
- `myId`：当前本地用户 id，可选。
- `adminView=1`：管理员视图，可选；只有管理员 session 有效时才生效。
- `all=1`：返回全量，不分页。
- `page`：页码，默认 1。
- `pageSize`：默认 20，最大 100。

响应：

```json
{
  "items": [],
  "myRecord": null,
  "stats": {
    "totalCount": 0,
    "averageScore": null
  },
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "totalItems": 0,
    "totalPages": 1,
    "hasPrevPage": false,
    "hasNextPage": false
  }
}
```

`items` 中公开字段处理：

- 移除 `scoreScreenshot`、`editKey`。
- 学生视图非本人姓名脱敏。
- 学生视图非本人不返回 `qq`。
- `isRecommended` 仅管理员或本人可见。
- `canEdit` 仅本人为 true，但学生端仍不允许二次修改。
- 非录取批次返回 `rank`。
- 录取批次不返回 `rank`。

### 获取提交 token

```http
GET /api/score-submit-token
```

响应：

```json
{
  "token": "一次性token",
  "expiresInSeconds": 300
}
```

### 学生提交登记

```http
POST /api/scores
X-Score-Submit-Token: <token>
Content-Type: application/json
```

成功响应：

```json
{
  "success": true,
  "data": {
    "id": 1,
    "isUpdate": false
  }
}
```

通用校验：

- 姓名必填。
- 当前批次内姓名不能重复，重复返回 409：
  - `该姓名在当前批次已登记，不能重复提交。如需修改请联系管理员。`
- 联系方式必填。
- 当前批次内联系方式不能重复，重复返回 409：
  - `该QQ号在当前批次已登记，不能重复提交。如需修改请联系管理员。`
  - 或 `该微信号在当前批次已登记，不能重复提交。如需修改请联系管理员。`
- 任何成功新增都要 `io.emit('update_scores')`。

普通成绩校验：

- 机构必填。
- 高数 <=150。
- 外语 <=120。
- 理论 <=150。
- 实操 <=80。
- 总分 >=380 时一志愿必填。
- 总分 <380 时不允许填写一志愿。

退役成绩校验：

- 分数 <=150。
- 一志愿必填且必须在退役院校候选学校集合中。

录取批次校验：

- 录取院校必选且必须在当前批次候选列表中。
- 录取专业必选且必须属于该院校。
- 录取分数必须有效且 >0。
- 普通录取必须选择是否保送生。

### 学生二次修改

```http
PUT /api/scores/:id
```

永远返回 403：

```json
{
  "error": "学生端不支持二次修改成绩，请联系管理员处理"
}
```

### 管理员会话

```http
GET /api/admin/session
```

见管理员认证章节。

### 管理员登录

```http
POST /api/admin/login
POST /api/admin/login/password
POST /api/admin/login/totp
```

支持密码和 TOTP。当前 UI 使用密码。

### 管理员退出

```http
POST /api/admin/logout
```

清除 cookie，响应：

```json
{
  "success": true
}
```

### 登记防护状态

```http
GET /api/admin/score-protection
```

需要管理员。

响应：

```json
{
  "enabled": false,
  "blockedIpCount": 0,
  "submitTokenRequired": false,
  "sameSiteRequired": false,
  "submitRateLimited": false,
  "ipNameLimited": false
}
```

### 更新登记防护

```http
PUT /api/admin/score-protection
```

请求：

```json
{
  "enabled": true
}
```

响应：

```json
{
  "success": true,
  "enabled": true
}
```

### 管理员添加记录

```http
POST /api/admin/scores
```

需要管理员。

成功响应：

```json
{
  "success": true,
  "data": {
    "id": 1,
    "isUpdate": false
  }
}
```

校验：

- 姓名必填。
- `totalScore` 必填、非负。
- normal `totalScore <= 500`。
- retired `totalScore <= 150`。
- `admission_retired` 管理员添加时微信号必填。
- 同批次姓名不能重复。
- 联系方式非空时，同批次联系方式不能重复。
- 成功后 emit `update_scores`。

### 管理员更新记录

```http
PUT /api/admin/scores/:id
```

需要管理员。

请求可包含：

- `highMath`
- `english`
- `compTheory`
- `compPractical`
- `totalScore`
- `firstChoice`
- `admissionSchool`
- `admissionMajor`
- `admissionScore`
- `isRecommended`

UI 只更新普通/退役成绩。后端可以保持更通用。

成功响应：

```json
{
  "success": true,
  "data": {
    "id": 1
  }
}
```

### 管理员删除记录

```http
DELETE /api/admin/scores/:id
```

需要管理员。

成功：

```json
{
  "success": true
}
```

### 管理员录取分统计

```http
GET /api/admin/admission-score-stats?batchType=admission
```

需要管理员。

响应：

```json
{
  "batchType": "admission",
  "updatedAt": "2026-05-07T00:00:00.000Z",
  "totals": {
    "totalCount": 0,
    "eligibleCount": 0,
    "excludedRecommendedCount": 0
  },
  "schools": [
    {
      "school": "南京工程学院",
      "majors": [
        {
          "school": "南京工程学院",
          "major": "软件工程",
          "totalCount": 0,
          "eligibleCount": 0,
          "excludedRecommendedCount": 0,
          "minScore": null,
          "maxScore": null
        }
      ]
    }
  ]
}
```

## 院校与专业数据

请在后端维护两个 JSON 文件：

- `admission-options-normal.json`
- `admission-options.json`，表示退役批次选项。

### 普通录取选项

```json
[
  { "school": "南京工程学院", "majors": ["软件工程"] },
  { "school": "南京晓庄学院", "majors": ["软件工程"] },
  { "school": "金陵科技学院", "majors": ["数字媒体技术"] },
  { "school": "南京工业职业技术大学", "majors": ["物联网工程技术", "软件工程技术", "网络工程技术", "人工智能工程技术", "工业互联网技术"] },
  { "school": "无锡职业技术大学", "majors": ["物联网工程技术", "软件工程技术"] },
  { "school": "常州大学", "majors": ["计算机科学与技术", "软件工程"] },
  { "school": "江苏理工学院", "majors": ["网络工程", "物联网工程"] },
  { "school": "苏州城市学院", "majors": ["计算机科学与技术"] },
  { "school": "苏州职业技术大学", "majors": ["人工智能工程技术"] },
  { "school": "苏州科技大学", "majors": ["计算机科学与技术"] },
  { "school": "江苏海洋大学", "majors": ["计算机科学与技术", "软件工程"] },
  { "school": "徐州工程学院", "majors": ["计算机科学与技术"] },
  { "school": "淮阴师范学院", "majors": ["地理信息科学"] },
  { "school": "南京师范大学泰州学院", "majors": ["计算机科学与技术"] },
  { "school": "三江学院", "majors": ["软件工程"] },
  { "school": "南通理工学院", "majors": ["计算机科学与技术", "数据科学与大数据技术"] },
  { "school": "南京航空航天大学金城学院", "majors": ["计算机科学与技术"] },
  { "school": "南京理工大学紫金学院", "majors": ["计算机科学与技术", "软件工程", "物联网工程"] },
  { "school": "南京审计大学金审学院", "majors": ["计算机科学与技术", "信息安全", "数据科学与大数据技术"] },
  { "school": "南京工业大学浦江学院", "majors": ["计算机科学与技术", "软件工程"] },
  { "school": "常州大学怀德学院", "majors": ["计算机科学与技术"] },
  { "school": "苏州科技大学天平学院", "majors": ["计算机科学与技术"] },
  { "school": "无锡太湖学院", "majors": ["计算机科学与技术"] },
  { "school": "南京理工大学泰州科技学院", "majors": ["软件工程"] },
  { "school": "南京师范大学中北学院", "majors": ["计算机科学与技术", "数据科学与大数据技术"] },
  { "school": "江苏师范大学科文学院", "majors": ["计算机科学与技术"] },
  { "school": "南京传媒学院", "majors": ["计算机科学与技术", "数字媒体技术"] },
  { "school": "扬州大学广陵学院", "majors": ["软件工程"] }
]
```

### 退役录取选项

```json
[
  { "school": "南京工程学院", "majors": ["软件工程"] },
  { "school": "南京晓庄学院", "majors": ["软件工程"] },
  { "school": "金陵科技学院", "majors": ["数字媒体技术"] },
  { "school": "南京工业职业技术大学", "majors": ["物联网工程技术", "软件工程技术", "网络工程技术", "人工智能工程技术", "工业互联网技术"] },
  { "school": "无锡职业技术大学", "majors": ["物联网工程技术", "软件工程技术"] },
  { "school": "常州大学", "majors": ["软件工程"] },
  { "school": "江苏理工学院", "majors": ["网络工程", "物联网工程"] },
  { "school": "苏州城市学院", "majors": ["计算机科学与技术"] },
  { "school": "苏州职业技术大学", "majors": ["人工智能工程技术"] },
  { "school": "苏州科技大学", "majors": ["计算机科学与技术"] },
  { "school": "江苏海洋大学", "majors": ["计算机科学与技术", "软件工程"] },
  { "school": "徐州工程学院", "majors": ["计算机科学与技术"] },
  { "school": "淮阴师范学院", "majors": ["地理信息科学"] },
  { "school": "南京师范大学泰州学院", "majors": ["计算机科学与技术"] },
  { "school": "三江学院", "majors": ["软件工程"] },
  { "school": "南通理工学院", "majors": ["计算机科学与技术", "数据科学与大数据技术"] },
  { "school": "南京航空航天大学金城学院", "majors": ["计算机科学与技术"] },
  { "school": "南京理工大学紫金学院", "majors": ["计算机科学与技术", "物联网工程"] },
  { "school": "南京审计大学金审学院", "majors": ["计算机科学与技术", "信息安全", "数据科学与大数据技术"] },
  { "school": "南京工业大学浦江学院", "majors": ["计算机科学与技术", "软件工程"] },
  { "school": "常州大学怀德学院", "majors": ["计算机科学与技术"] },
  { "school": "苏州科技大学天平学院", "majors": ["计算机科学与技术"] },
  { "school": "无锡太湖学院", "majors": ["计算机科学与技术"] },
  { "school": "南京理工大学泰州科技学院", "majors": ["软件工程"] },
  { "school": "南京师范大学中北学院", "majors": ["计算机科学与技术"] },
  { "school": "江苏师范大学科文学院", "majors": ["计算机科学与技术"] },
  { "school": "南京传媒学院", "majors": ["计算机科学与技术"] },
  { "school": "扬州大学广陵学院", "majors": ["软件工程"] }
]
```

## Socket.IO

后端：

- 创建 HTTP server 包裹 Express。
- Socket.IO path：`/fenshu/socket.io`。
- CORS origin 同 API。
- 客户端连接后可以只记录日志。
- 所有新增、管理员更新、管理员删除成功后 emit：

```js
io.emit('update_scores')
```

前端：

- 选择批次后建立 socket。
- 监听 `update_scores`。
- debounce 1000ms 后刷新当前列表。
- 卸载时 disconnect。

## 环境变量

后端支持：

```env
NODE_ENV=production
DATABASE_URL=file:/app/data/prod.db
PORT=3000
ADMIN_TOTP_SECRET=
ADMIN_PASSWORD=
ADMIN_JWT_SECRET=
ADMIN_TOKEN_TTL=15m
ADMIN_TOTP_PERIOD=30
ADMIN_LOGIN_MAX_FAILURES=5
ADMIN_LOGIN_LOCK_MINUTES=15
ADMIN_COOKIE_SECURE=false
ADMIN_COOKIE_SAME_SITE=strict
CORS_ALLOW_ORIGINS=http://localhost:5173,http://localhost:4173
BLOCKED_SCORE_SUBMIT_IPS=
SCORE_SUBMIT_TOKEN_TTL_SECONDS=300
SCORE_SUBMIT_TOKEN_MAX_PER_MINUTE=20
SCORE_SUBMIT_IP_NAME_WINDOW_SECONDS=600
SCORE_SUBMIT_IP_MAX_NAMES=3
SCORE_SCREENSHOT_DIR=
```

注意：

- `ADMIN_JWT_SECRET` 必须配置，否则管理员登录返回 500。
- 密码登录需要 `ADMIN_PASSWORD`。
- TOTP 登录需要 `ADMIN_TOTP_SECRET`。
- `DATABASE_URL` 在 Docker 中为 `file:/app/data/prod.db`。

## Docker 部署

### docker-compose.yml

必须包含两个服务和一个数据卷：

- `fenshu-backend`
  - build `./server`
  - container_name `fenshu-backend`
  - restart `unless-stopped`
  - `NODE_ENV=production`
  - `DATABASE_URL=file:/app/data/prod.db`
  - `PORT=3000`
  - volume：`fenshu-data:/app/data`
  - network：external `projects_app-network`
  - healthcheck：`http://localhost:3000/health`
- `fenshu-frontend`
  - build `./client`
  - container_name `fenshu-frontend`
  - restart `unless-stopped`
  - depends_on backend
  - network：external `projects_app-network`
- volume：
  - `fenshu-data`
- network：
  - external name `projects_app-network`

### 后端 Dockerfile

- 基于 `node:18-alpine`。
- 安装 `openssl libc6-compat`。
- `npm ci`。
- 复制 `prisma` 后 `npx prisma generate`。
- 复制源码。
- 启动命令：

```sh
node node_modules/prisma/build/index.js migrate deploy && node index.js
```

### 前端 Dockerfile

- builder 基于 `node:18-alpine`。
- `npm ci`。
- `vite build`。
- runtime 基于 `nginx:alpine`。
- 把 `dist` 复制到 `/usr/share/nginx/html`。
- 复制 `nginx.conf`。

### 前端 Nginx

容器内前端 Nginx：

- `root /usr/share/nginx/html`
- `try_files $uri $uri/ /index.html`
- 静态资源缓存 1 年。
- 开 gzip。

外层反向代理需要：

- `/fenshu/` 转发到 `fenshu-frontend`。
- `/fenshu/api/` 去掉 `/fenshu` 前缀后转发到 `fenshu-backend:3000/api/`。
- `/fenshu/socket.io` 转发到 `fenshu-backend:3000/fenshu/socket.io`，支持 websocket upgrade。

## 视觉风格要求

- 整体是轻量后台/登记工具风格，不做营销落地页。
- 背景浅灰 `bg-gray-50`。
- 主卡片白底、`rounded-xl`、轻阴影、细边框。
- 主色蓝色 `blue-600`。
- 成功/导出使用 emerald。
- 危险操作使用 red。
- 防护开启使用 orange。
- 管理员模式提示使用 red。
- 搜索命中高亮使用 amber。
- 当前用户记录高亮使用 blue。
- 表单输入统一边框圆角，聚焦时可加蓝色边框/阴影。
- 图标全部用 `lucide-react`：
  - `Activity`
  - `Edit2`
  - `Save`
  - `Trash2`
  - `Shield`
  - `Zap`
  - `X`
  - `MessageCircle`
  - `Download`
  - `Search`
  - `Plus`
  - `BarChart3`
  - `RefreshCw`
- 移动端必须可用：
  - 顶部批次切换 2 列。
  - 表格横向滚动。
  - 表单 grid 在小屏单列。
  - 管理员按钮可换行。

## 错误文案要求

请尽量使用这些中文错误文案：

- `请先选择批次`
- `你已完成登记，如需修改请联系管理员`
- `请填写姓名`
- `请输入机构名称`
- `请填写QQ联系方式`
- `请填写QQ号`
- `请填写微信号`
- `请选择是否为保送生`
- `{科目}不能大于{max}分，请重新输入`
- `总分达到 380 分及以上时，请选择一志愿`
- `请从下拉候选中选择一志愿院校`
- `请从下拉候选中选择录取院校`
- `请选择该录取院校对应的录取专业`
- `请填写有效的录取分数`
- `提交失败，请稍后重试`
- `管理员登录失败，请重试`
- `管理员登录已过期，请重新登录`
- `请先登录管理员模式`
- `当前没有可导出的登记数据`
- `删除失败：请稍后重试`
- `修改失败，请稍后重试`
- `院校分数统计获取失败，请稍后重试`

## 文件结构建议

```text
project-root/
  docker-compose.yml
  client/
    package.json
    vite.config.js
    tailwind.config.js
    postcss.config.js
    Dockerfile
    nginx.conf
    index.html
    src/
      main.jsx
      App.jsx
      index.css
      wechat_qr.png
  server/
    package.json
    Dockerfile
    index.js
    admission-options.json
    admission-options-normal.json
    prisma/
      schema.prisma
      migrations/
```

## 验收清单

实现完成后必须逐项自测：

1. 未选批次时只显示批次选择页。
2. 四个批次切换后表单、表格列、联系方式 label 都正确。
3. 普通成绩总分实时计算，低于 380 禁用一志愿，达到 380 必填一志愿。
4. 退役成绩一志愿必须从院校候选中选。
5. 录取院校必须从候选中选，专业随院校变化。
6. 普通录取必须选择是否保送生。
7. 学生提交成功后本地缓存用户，并显示“已完成登记”状态。
8. 同批次姓名重复被后端拒绝。
9. 同批次 QQ/微信重复被后端拒绝。
10. 学生 `PUT /api/scores/:id` 永远 403。
11. 列表分页、每页数量、排名、平均分正常。
12. 学生视图其他人姓名脱敏且不显示联系方式。
13. 管理员隐藏路径 `/fenshu/admin-2026` 可登录。
14. 管理员可添加、搜索、删除记录。
15. 管理员可编辑普通/退役成绩记录，录取批次不显示编辑按钮。
16. 管理员 Excel 导出列和文件名正确。
17. 管理员登记防护开关可保存，开启后 token/来源/频率限制生效。
18. 录取最低/最高分统计普通批次会排除保送生。
19. Socket.IO 新增/修改/删除后其他客户端 1 秒内刷新。
20. 页面每 5 秒自动刷新。
21. Docker 构建后前端可通过 `/fenshu/` 访问，API 通过 `/fenshu/api/` 访问，Socket 通过 `/fenshu/socket.io` 工作。

## 关键不要偏离的点

- 不要把录取结果批次做成排行榜排名，录取批次表格不显示排名。
- 不要让学生端二次修改，学生端只能首次登记，修改必须找管理员。
- 不要在普通录取统计里把保送生计入最低/最高分。
- 不要把退役批次联系方式写成 QQ，退役相关批次使用微信号。
- 不要让学生端录取院校/专业自定义输入，必须从候选选择。
- 管理员添加录取记录可以手输院校/专业，并且统计中要能显示候选外数据。
- 不要删除 `volunteers`、`editKey`、`scoreScreenshot` 等兼容字段。
- 不要省略 Socket.IO 实时更新。
- 不要省略 5 秒自动刷新。
- 不要省略 `/fenshu` 路径前缀和 `/fenshu/admin-2026` 管理员入口。
