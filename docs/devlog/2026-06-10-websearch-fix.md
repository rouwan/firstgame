# WebSearch/WebFetch 不可用 —— 排查文档

**日期**：2026-06-10
**环境**：VSCode + Claude Code 2.1.169 + CCSwitch 3.14.1 + DeepSeek v4 Pro
**问题**：WebSearch 和 WebFetch 均返回 400 错误

---

## 错误信息

```
API Error: 400 thinking options type cannot be disabled when reasoning_effort is set
```

## 根本原因分析

Claude Code 调用 WebSearch/WebFetch 时，在 API 请求中**同时发送了两个冲突的参数**：

| 参数 | 来源 | 说明 |
|------|------|------|
| `reasoning_effort` | 会话默认配置（`interleaved-thinking` beta） | 控制模型"思考深度" |
| `thinking: { type: "disabled" }` | WebSearch/WebFetch 工具基础设施 | 搜索/抓取是轻量任务，不需要深度思考 |

DeepSeek 的 Anthropic 兼容 API **拒绝这种组合**。主对话能正常工作是因为主对话不设置 `thinking: disabled`。

## 排查过程

### 已尝试的修改（均在 `%USERPROFILE%\.claude\settings.json`）

| # | 修改内容 | 结果 |
|---|---------|------|
| 1 | 移除 `ANTHROPIC_DEFAULT_HAIKU_MODEL` | ❌ 无效 |
| 2 | 所有模型名去掉 `[1m]` 后缀（`deepseek-v4-pro[1m]` → `deepseek-v4-pro`） | ❌ 无效 |
| 3 | 添加 `"alwaysThinkingEnabled": false`（用户级 + 项目级） | ❌ 无效 |
| 4 | 添加 `ANTHROPIC_BETAS` 环境变量，排除 `interleaved-thinking` 和 `context-1m` | ❌ 无效 |
| 5 | 添加 `"effortLevel": "low"` | ❌ 无效 |

每次修改后均执行了 **退出 CCSwitch → 重启 CCSwitch → VSCode Reload Window**。

### 当前配置文件状态

**`%USERPROFILE%\.claude\settings.json`**：
```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://api.deepseek.com/anthropic",
    "ANTHROPIC_AUTH_TOKEN": "sk-xxx",
    "ANTHROPIC_MODEL": "deepseek-v4-pro",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "deepseek-v4-pro",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "deepseek-v4-pro",
    "ANTHROPIC_BETAS": "claude-code-20250219"
  },
  "alwaysThinkingEnabled": false,
  "effortLevel": "low",
  "permissions": { ... },
  "theme": "light"
}
```

**`<项目>/.claude/settings.json`**：
```json
{
  "alwaysThinkingEnabled": false,
  "permissions": { ... }
}
```

**CCSwitch 信息**：
- 路径：`F:\软件\ccswitch\cc-switch.exe`
- 版本：**3.14.1**
- 数据目录：`%APPDATA%/Roaming/com.ccswitch.desktop/`（几乎为空，仅 `app_paths.json: {}`）

---

## 推测

1. **`reasoning_effort` 不是通过设置控制的**。Claude Code 可能在工具基础设施层（WebSearch/WebFetch）硬编码了 `thinking: disabled`，同时从模型/SDK 层面自动附加了 `reasoning_effort`。这些参数绕过了 `alwaysThinkingEnabled` 和 `effortLevel` 设置。

2. **CCSwitch 3.14.1 可能没有处理 `reasoning_effort`**。CCSwitch 作为 API 中转代理，理想情况下应该剥离 DeepSeek 不支持的参数（如 `reasoning_effort`），但当前版本可能没有做这个处理。

3. **版本组合问题**。Claude Code 2.1.168/169 版本引入了 `interleaved-thinking` beta 默认启用，而 CCSwitch 3.14.1 发布时可能还没有这个参数，所以没有对应的处理逻辑。

---

## 对比清单（用于正常电脑排查）

请在**能正常使用 WebSearch 的电脑**上检查以下信息：

### 1. 版本对比
```
CCSwitch 版本：？
Claude Code VSCode 扩展版本：？（code --list-extensions --show-versions | grep claude）
Claude Code CLI 版本：？（claude --version）
```

### 2. 配置文件对比
```
%USERPROFILE%\.claude\settings.json 内容：
？和上面有什么不同（特别注意 env、betas 相关字段）
```

### 3. CCSwitch 版本
- 如果正常电脑的 CCSwitch 版本 **> 3.14.1**，说明新版已修复
- 如果正常电脑的 CCSwitch 版本 **< 3.14.1**，可能是旧版 Claude Code 没发 `reasoning_effort`
- 如果**完全相同**，则差异在其他地方

### 4. 可能有效的修复方向
- **升级 CCSwitch** 到最新版
- **降级 Claude Code** VSCode 扩展（如果正常电脑用的是更早版本）
- **联系 CCSwitch 开发者**报告 `reasoning_effort` 参数兼容性问题
- **尝试 CCSwitch 的设置界面**中是否有"参数过滤"或"兼容模式"选项

---

## 附录：正常工作的请求（主对话）vs 失败的请求（WebSearch）

```
主对话请求参数：
  model: deepseek-v4-pro
  reasoning_effort: <value>    ← 没问题，DeepSeek 能接受
  （没有 thinking: disabled）

WebSearch 请求参数：
  model: deepseek-v4-pro  
  reasoning_effort: <value>    ← 冲突！
  thinking: { type: "disabled" }  ← 冲突！
  ❌ DeepSeek 400 错误
```
