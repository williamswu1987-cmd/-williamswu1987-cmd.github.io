# 24 条原则（pstack 原则速查）

来源：pstack v0.15.36 `docs/guide/08-principles.md` 与 `skills/poteto-mode/SKILL.md` 的 Principles 索引。
用法：用名字指挥。不背清单，需要时回来查。引用一条原则时，必须说清它改变了哪个具体决定。

## 核心：建多少、何时推倒重来

- **laziness protocol**。重构、估 diff、想加抽象、层或信号时用。偏向删除，做能解决问题的最小改动。
- **foundational thinking**。写逻辑之前用。先定核心类型与数据结构，再定脚手架与功能的顺序，再看并发角色共享什么。
- **redesign from first principles**。把新需求接进已有设计时用。按它第一天就存在那样重新设计。
- **attack the premise**。两个以上修法在同一个关口失败时用。把它们共享的前提写下来，先直接测这个前提，再写下一个修法。
- **subtract before you add**。加东西、重构或重写之前用。先删死代码，再在更简单的底子上建。
- **minimize reader load**。评审或整理难读的代码时用。数层数与隐藏状态，合并只被调一次的包装，缩小可变范围。
- **outcome-oriented execution**。有明确阶段边界的改写与迁移时用。收敛到目标架构，不保留一次性的兼容状态。
- **experience first**。产品、体验或功能范围取舍时用。选用户得到的，不选实现方便的。
- **exhaust the design space**。没有先例的新颖交互或架构决策时用。先做 2 到 3 个竞争原型比较再定。
- **build the lever**。任何非平凡工作都用。把能做或能证明这件事的工具（codemod、脚本、生成器）造出来，不要手工做。工具是评审能重跑的产物。

## 架构：状态、校验、兼容放哪里

- **model the domain**。写有状态逻辑，或代码到处分支、到处重复同一形状假设时用。把领域编进一个结构（状态机、类型模型、表、注册表、reducer、边界、合适的集合），不要散落在条件里。
- **boundary discipline**。接校验、错误处理或框架适配器时用。边界处做守卫，内部信任类型，业务逻辑保持纯净。
- **type system discipline**。设计类型或签名时用。让非法状态写不出来，给基础类型加品牌，外部数据在边界处解析。
- **make operations idempotent**。设计会在崩溃与重试中跑的命令、生命周期步骤或循环时用。收敛到同一个终态。
- **migrate callers then delete legacy apis**。引入新内部 API 而老调用方还在时用。一波之内迁完并删掉老的。
- **separate before serializing shared state**。并发角色可能写同一个文件、分支、键或对象时用。先消除共享，再谈协调。

## 验证：什么算证明

- **prove it works**。做完任务、宣称完成之前用。对着真实产物验证，不对代理指标或“能编译”验证。
- **fix root causes**。调试时用。每个症状追到系统第一次出错的地方，在那里修。守卫只有在被处理的状态本身合法时才算修法。
- **sequence verifiable units**。多步工作（扫荡、迁移、一批相似修改）以及叠 commit 与 PR 时用。切成小单元，每单元以一次检查收尾，验完再做下一个，交付顺序本身就能自证。
- **test behavior not implementation**。写、改或保留测试时用。断言代码使用者能观察到的行为。行为坏了测试就红，只改内部实现测试还绿。
- **explain the number**。测量之前，以及信任、汇报或依据一个自己测出的数字行动之前用。先找出限制它的因素，排除它测的其实是别的东西。

## 分工：并行不出乱子

- **guard the context window**。上下文快满时用（大输出、长文件、反复读、发散规划）。大批量阅读分给新开的会话，主会话只留结论。
- **never block on the human**。想问“要不要做 X”时用。可逆的事直接做，报结果，让人纠正。

## 元原则

- **encode lessons in structure**。发现自己第二次写同一条指令时用。把它编成 lint、元数据标记、运行时检查或脚本，不要再加文字。见 `skills/03-correct.md`。
