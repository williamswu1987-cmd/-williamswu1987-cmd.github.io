# pstack-grokbot：只用 Grok Bot 的 pstack 精简版

改编自 Lauren Tan（@poteto）的 **pstack v0.15.36**（MIT 协议，源码在 github.com/cursor/plugins/tree/main/pstack）。
原版是 Cursor / Claude Code 的插件：58 个 skills、23 套 playbooks、Cursor 内置的 `/loop`、Task 子代理与模型配置。
本版按“用户只有 Grok Bot”改写：去掉插件运行时与多模型分工，只留下 Grok Bot 在仓库里就能执行的纪律。

## 文件清单

| 文件 | 作用 |
|---|---|
| `AGENTS.md` | 唯一入口。拷到仓库根目录，Grok Bot 每次开工都先读它 |
| `skills/00-poteto-mode.md` | 主会话的工作方式：接任务、匹配 playbook、分派、回复格式 |
| `skills/01-principles.md` | 24 条原则速查（每条一句话触发条件） |
| `skills/02-playbooks.md` | 8 套 playbook：调查、修 bug、新功能、重构、原型、性能、多阶段计划、过夜跑 |
| `skills/03-correct.md` | `/correct`：把重复犯的错焊进结构 |
| `skills/04-verify.md` | 验证技能：像用户一样驱动真实应用并留证据 |
| `skills/05-review.md` | 开 PR、独立评审、跟进（Babysit）、合入（Shipping） |
| `skills/06-no-comments.md` | Comment Sicko：删注释，杀绕过办法 |
| `skills/07-interrogate.md` | 对抗审查：只有被真实运行证明的发现才算数 |
| `skills/08-architect.md` | 架构草图：摸清、画草图、定稿、实现、推倒 |
| `skills/09-loop.md` | 过夜跑：完成条件谓词、每次迭代记 `decisions.tsv`、早上审计 |
| `skills/10-how-why.md` | 先搞懂再动手：how、why、teach、recall |
| `skills/11-automate-me.md` | 把你自己的习惯变成 skill |
| `skills/decisions-template.tsv` | `decisions.tsv` 的表头与四行例子 |
| `skills/verify-app-template.md` | 新验证技能的空白模板 |
| `PSTACK-README.md` | 本文件（仓库根目录已另有 README.md，故改名存放） |

## 怎么装进仓库

1. 把 `AGENTS.md` 拷到仓库根目录（已有 `AGENTS.md` 时，把“怎么派活”与“不可协商的规矩”两节合并进去，不要覆盖你原有的内容）。
2. 把整个 `skills/` 目录拷到仓库根目录（与 `AGENTS.md` 平级）。
3. 在仓库里跑一次 `03-correct.md`：翻最近的 commit、revert 与评审意见，把 agent 连踩两次的坑转成 lint 或检查。
4. 有用户界面或 CLI 的项目，再跑一次 `04-verify.md`，生成 `skills/verify-<app>.md`。

不需要装任何插件，不需要改任何配置。Grok Bot 读仓库文件就能按这套纪律走。

## 怎么派活（Grok Bot 调用示例）

Grok Bot 的调用方式按你实际用的为准（X 上 @ 它或在 PR 里指派）。不管哪种入口，任务正文只写三样：**目标、验收标准、要看的证据**。不要写流程说明书。

功能示例：

```text
目标：给导出接口加重试，重试时不再写入重复行。
验收：导出的行数与源数据一致；重试三次后仍无重复行；现有导出测试全绿。
证据：复现脚本的改前改后输出、测试运行结果、PR 链接。
按仓库 AGENTS.md 的 pstack 纪律走。
```

修 bug 示例：

```text
目标：滚动条静置 750ms 后自己漂移的问题。
验收：静置 10 分钟零漂移；现有滚动测试全绿。
证据：复现前后的录屏或日志、根因说明、PR 链接。
先复现再修，按仓库 AGENTS.md 的 pstack 纪律走。
```

过夜示例：

```text
去睡了。把所有调用方迁到新解析器，在 main 之外的新分支做。
完成条件：零旧调用方、全部解析器 fixture 通过、旧 API 已删。
每次迭代记 decisions.tsv。提交前不要问我。
如果几个小时后真的卡死了，停下来写清原因。
```

## 保留了什么，砍掉了什么

**保留（全部是原版的核心）**

- 单入口纪律：只给目标、验收与证据，不写流程说明书。
- 24 条原则全文索引与触发条件。
- `/correct` 的“错两次才立规矩、在最高层修、用真实历史错误证明检查”的闭环。
- 验证技能的生成方法（先问仓库、Feature Map、自己先跑一遍）。
- 窄 PR（5 个窄 PR 胜过 1 个胖 PR）、PR 正文结构、写码者不自审、独立验收、按验证过的一段自底向上合入。
- Comment Sicko 的注释观：能改成类型、改名或 lint 的，就不要留注释。
- 对抗审查“只有被运行证明的发现才算数”。
- 架构的 Ground / Sketch / Agree / Implement / Scrap，至少两个结构不同的候选。
- 过夜跑的完成条件谓词、每次迭代记 `decisions.tsv`、早上审计。
- how / why / teach / recall 的“先搞懂再动手”。

**砍掉（只因为 Grok Bot 单模型、没有插件运行时才砍）**

- `/setup-pstack` 模型配置与预算档（`pstack-models.mdc`）：没有多模型可配。所有角色都用 Grok。
- 多模型分工：原版 Grok 写代码、Opus 5.5 做判断与写散文、交叉裁判必须换模型家族。本版用“全新 Grok Bot 会话”代替第二模型。评审的多样性比原版弱，复杂改动更依赖用户过目。
- Cursor 内置能力：`/loop` 唤醒、`watch-pr` 脚本、Task 子代理类型（poteto-agent、comment-sicko 的派生方式）、`/deslop`、`/technical-writing`、`/unslop` 插件。对应规则已改写成文字版，放在各 skill 文件里。
- `benny` 自动化包（Slack 工单自动 triage 与复现）：需要定时触发器，本版没有。它的阶段思想（每阶段都能停线、每阶段交证据）写进了 `09-loop.md`。
- 语言专属与小众 skill：`typescript-best-practices`、`benchmark-checklist`（只在 `01-principles.md` 的 explain the number 里保留一句话）、`statechart` / TLA+ 形式化验证（高级可选，未写进核心流程）、`ketchup-video`、`make-bot-ui`、`bro`（语气）、`reflect`、`sharpen`、`blast-radius`、`eval`、`figure-it-out`（其思想并入 `02-playbooks.md` 的 Multi-phase plan）、`maintain-verification-skill`（并入 `04-verify.md` 的第 5 节）。
- 23 套 playbooks 合并为 8 套：`trace-forensics` 与 `runtime-forensics` 并入 Bug fix 的诊断步骤；`hillclimb` 并入 Perf；`autopilot-full` 与 `autopilot-stack` 需要云端 agent 与 watcher，本版没有，改用 `09-loop.md` 加手动合入；`pause-safely` 与 `session-pickup` 是 Cursor 会话概念，本版用 `decisions.tsv` 加书面交接代替；`worktree-cleanup`、`visual-parity`、`authoring-a-skill` 未单列（最后一条的思想在 `11-automate-me.md`）。

## 局限（先说清楚）

1. **没有真正的多模型评审**。原版要求评审方换模型家族，本版只能用新开的 Grok 会话。两个 Grok 会话的一致性不如跨模型一致性强。重要改动请用户亲自过目。
2. **没有并行扇出**。原版一次派多个子代理并行跑 arena 与 swarm。本版是依次开新会话，慢一些。急活先做最小可用版本。
3. **没有 `/loop` 自动唤醒**。过夜跑就是一次次调用 Grok Bot。每次调用都要把 `decisions.tsv` 与上次的进度贴给它，不然它会从头开始。
4. **Grok Bot 的具体调用方式没有在本包里写死**。X 上 @ 它、在 PR 里指派、还是别的入口，按你实际用的为准。本包只规定任务正文的写法。
5. **本包没有动过真实项目验证**。`04-verify.md` 的第 4 节要求每个验证技能自己先跑一遍。同样道理：第一次用时，先在一个小任务上跑通，再用到大改动上。

## 来源与协议

- 原项目：pstack v0.15.36，作者 Lauren Tan，MIT 协议。
- 上游地址：github.com/cursor/plugins/tree/main/pstack
- 本改编同样按 MIT 协议提供。改动内容见上两节。
