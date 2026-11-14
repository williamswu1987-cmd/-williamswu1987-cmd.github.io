# PR、评审与合入（Grok Bot 版）

来源：pstack v0.15.36 `skills/poteto-mode/playbooks/opening-a-pr.md`、`shipping.md`、`babysit.md`。
删掉的部分：`/deslop`、`/technical-writing`、`/unslop`（Cursor 插件）、`watch-pr` 脚本、Origin 与 `gt` 工具链、Cursor 云端 verifier。保留的规则全部可以直接在 GitHub 上执行。

## 开 PR

**工作区**。在 main 之外的工作区（worktree 或分支）工作。多个任务共用一个分支时，每人自己的工作区，或在任务之间 `git fetch && git reset --hard origin/<branch>`。脏分支上有无关改动时，先 patch 出来，换干净工作区，再贴回去。

**提交**。多提交，小而有序。每个提交都是未来的一个 PR：可独立合入，顺序能讲清故事。修法属于刚做的提交就 amend，可分开就新提交。提交正文不重复标题。

**标题**。Conventional Commits：`type(scope): subject`，没有结尾句号。type 如 `feat`、`fix`、`docs`、`refactor`、`test`、`chore`、`perf`。scope 是区域。subject 短祈使句，改动由某个真实符号承载时点它的名。

**正文**。PR 正文是一分钟简报，给手里拿着 diff 的评审看。写为什么改、没改什么、可能 break 什么、怎么证明它工作。短句，少标识符，不要大段文字。章节顺序如下，没有可说的就删掉该节：

- `## Why`：问题与做法，1 到 3 句短话。不要 SHA、rebase 家谱、“基于 main”之类的开场。
- `## What changed`：1 到 3 个短 bullet。只在符号或路径承载改动时点名。重命名写清两边。
- `## Scope`：必有。1 到 3 条，覆盖什么、刻意不覆盖什么（后续工作、已知缺口）。不要符号、路径或逐文件散文。
- `## Tradeoffs`：只有评审会追问的被拒备选才写。没有真实选择就跳过。
- `## Blast Radius`：1 到 2 句，碰了谁、为什么安全或危险。main 是红的就写清放着不管的代价。
- `## Verification`：1 到 3 个 bullet，每个都是真实跑过的路径与结果。性能给一个主数字带单位、`before → after`。不要样本量方法论或 metric 表。

章节之后贴视频或截图，只要它们能证明某个主张。完整 SHA、逐文件清单、“CLEAN”式结论放链接的产物里，不要放正文。

**大小与栈**。5 个窄 PR 胜过 1 个大 PR。栈是 base 分支链。根 PR 指向 trunk。每个子分支 rebase 到父分支的准确 tip 上，PR 的 base 指向父分支。父分支合入后，把子分支移到 trunk。只做独立工作时才从 trunk 拉分支。做大量栈工作前先 rebase 到 trunk。

**状态**。每个 PR 都以 ready 状态开，不要 draft。

**开 PR 不等于开始 babysit**。贴出链接，继续建。整个栈建完再统一跟进。每个新 PR 都 babysit 会拖住构建，还会把检查浪费在后面会被重跑的 commit 上。

## 评审：写码的人不自审

每个 PR 合入前，必须经过没写这段代码的一方实跑验收。

- **评审方**：优先新开一个 Grok Bot 会话（全新会话，不带写码会话的上下文），在 PR 上评审。没有新会话就由用户审。
- **评审方法**：像用户一样在匹配的表面上跑一遍改动（见 `04-verify.md` 的验证技能），父提交对 head 提交。结论只写三档：`PASS`、`PASS+NOTES`、`FAIL`。
- **CI 绿了不算验收**。CI 与 bot 评审都不像用户那样跑改动。
- 对 bugbot 或 agent 安全评审的评论保持怀疑。它们能抓到真 bug，也会报非问题与小事。每条按事实评估，噪音用具体理由驳回，不要为了消音改代码。修真问题时先拿红的证明，修在拥有那段代码的最底层 PR 里。

**限制（相对原版）**：原版要求评审方用另一个模型家族（Claude 审 Grok 写的）。单模型下做不到。替代办法是全新会话 + 用户抽查。评审的多样性比原版弱，复杂改动更依赖用户过目。这条限制是结构性的，见 README.md。

## Babysit（跟进到可合入）

在用户要求时才开始，通常是整个阶段或整个栈建完后，不是 PR 一开就开始。先把栈建完、变绿，再走 Shipping 合入。

1. **先定模式**。`drive` 是跑循环到可合入；`background` 是不挡路的 triage；`threads-only` 只回评审评论，什么都不动；`check` 是一次状态检查与汇报。没声明默认 `drive`。小 PR 或纯文档用 `check`。
2. **只做合入前沿**。最低的未合入 PR 是唯一重要的。上面的 PR 只读不修，不要为了上面的事重启前沿的检查。
3. **一个栈一个跟进人**。开始前确认没人已经在跟了。
4. **不改栈拓扑**。不在跟进里做 base 重定向、rebase、整栈提交或强制推送。在归属分支上修，rebase 形状的问题往上报，让 owner 做。
5. **顺序是冲突、评审串、CI**。每波已知修法打包成一次 push。冲突是唯一只报不修的阻塞：写清哪个分支需要 rebase，停下。不要绕去 CI 凑忙。
6. **CI 分类后再动**。flake 或基建问题只给一次全新构建，不要重试单个 job。第二次一模一样的失败就不是 flake，读日志重新分类。diff 没碰的代码失败了，说明 base 旧了，先检查再动。
7. **停在人的那条线**。跟进永远不授权合入。只有明确要求合入、发布、到就绪就合时，才走 Shipping。

## Shipping（合入）

你拥有合入。每个 PR 独立验证，只合从底部连续验证过的那一段，然后立刻停手。

1. **每个 PR 独立验证**。resolve forge（默认 `gh`）。每个 PR 一个 verifier（全新 Grok Bot 会话），在匹配表面上实跑改动，结论 `PASS`、`PASS+NOTES` 或 `FAIL`。只有没写代码的 agent 的 verdict 才算数。
2. **只合从底部连续验证过的段**。从最低未合入 PR 往上走，停在第一个没有 `PASS` 或 `PASS+NOTES` 的 PR。下面这一段就是可合入的，上面那个是天花板。已验证的 PR 在未验证的上面时也得等，因为它合入时离不开下面的代码。
3. **合入前重核 verdict 是否还描述当前代码**。verdict 覆盖的是一个 patch。rebase 会移动 SHA。对 `git patch-id` 做对比，变了就重验。
4. **自底向上一次合一个**。`gh pr merge <pr> --squash`。合入后读回 PR 状态确认真合入了（merge 命令报成功时可能只是进了合入队列）。然后把上面 PR 的 base 改到 trunk，patch 移过去，`git push --force-with-lease`。
5. **合入时别动栈**。第 4 步的移动是唯一允许的改动。卡住先查原因，再动任何东西。
6. **到天花板就停**。再往上要新 verdict，等于新一轮第 1 步。

**回复**：验证过的段与天花板、每个 PR 的 verdict 与谁给的、合入了什么与怎么确认的、下一个缺口要什么。
