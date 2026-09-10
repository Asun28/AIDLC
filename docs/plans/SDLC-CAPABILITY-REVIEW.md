# AI SDLC 现成能力对照与 aidlc-loop 取舍

核验日期：2026-09-10。范围：官方方法论、产品文档、仓库主线与代表性实现/测试。没有安装或运行这些框架，也没有复现厂商基准。文中“有实现”表示找到了相应代码或可操作产品文档，不等于已验证适配 MyInspection。

## 1. 结论

aidlc-loop 应保留为本仓的轻量开发入口：按需求和风险选择流程，复用 plan-forge 与 task.ps1，自动推进卡片，并验证整个目标。现在无需另外造一套完整调度、治理和审计平台；也不应将多个外部框架直接叠加在同一套卡片上。

当前方案能设计出“需求到合并”的闭环。要覆盖完整开发生命周期，还需按项目接入设计、真实业务验收、发布/迁移/恢复、上线观察与反馈。完整审计需要验证实际采集范围和证据，不能由一个日志文件或一句“Fully audited”成立。

## 2. 五个参照分别提供什么

| 参照 | 已有内容或机制 | 对 aidlc-loop 的建议 |
|---|---|---|
| Anthropic AI-Native SDLC playbook | 六阶段方法论、产物交接、测试/评审/部署/维护的执行示例与接入条件 | 用作生命周期检查表，补齐触发和产物；它本身不是装好即运行的全流程引擎 |
| IBM AI SDLC / Bob | 官方产品的 Plan/Agent/Ask、文件/命令/MCP 工具、skills、独立上下文子 agent、复杂功能实施教程 | 借鉴明确上下文、可审阅计划、按任务授权和局部恢复；不复制它的 IDE 或模型路由系统 |
| AWS AI-DLC Workflows | 当前主线有跨 harness 核心、原生 CLI、流程选择、阶段/单元编排、审批与状态恢复 | 适合比较完整引擎的复用价值；不能视为现有 task.ps1 的即插即用外壳 |
| specs.md | 多条 flow；FIRE 有 run 状态脚本、恢复和不同自治模式；另有状态/工件校验 | FIRE 是轻量需求执行的重点参照；安装时选 flow 不等于每个请求自动按 T0/T1/T2 路由 |
| ai-sdlc-framework/ai-sdlc | 可执行的多包框架，含就绪检查、调度恢复、策略接口和签名证据 | 借鉴治理与证据边界；实验性自治和不同状态/任务模型需单独评估 |

以下固定来源支持表中的具体判断。

## 3. Anthropic：方法论及接入示例

官方文章将流程分为 Plan、Design、Build、Test、Deploy、Maintain，并用可交接的产物连接。部署/维护部分要求配置受限工具、权限、环境和监控触发；它没有声称只加载一份 skill 就获得完整生产闭环。[官方 playbook](https://claude.com/blog/the-ai-native-sdlc-playbook)

长任务研究强调可恢复上下文、明确功能列表、逐项推进和实际端到端验证，可用于防止提前宣布完成。[Long-running agent harness](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)

**采纳：** 保留已接受目标→计划→卡片→代码/验证→交付证据的关系；把生产反馈作为受授权的新输入。沿用本仓工件命名和计划落位，不额外复制一套 intent/spec/plan 真相源。

## 4. IBM：区分概念文章与 Bob 产品

IBM 的 [AI in the SDLC](https://www.ibm.com/think/topics/ai-in-sdlc) 是阶段能力概述；可操作的产品参照是 [Bob 文档](https://bob.ibm.com/docs/ide)。复杂功能教程展示了计划文件、范围/层次/约束/验收定义、审阅后实施的路径。[Plan and implement complex features](https://bob.ibm.com/docs/ide/tutorials/create-a-plan-and-implement-complex-features)

Bob 的子 agent 在独立上下文完成明确任务并返回摘要；文档也明确存在启动批准及 mode 限制。其支持文件可承载 skill 细节。这支持按需上下文设计，不能推导出任何宿主都可无确认并行运行。[Subagents](https://bob.ibm.com/docs/ide/features/subagents)，[Skills](https://bob.ibm.com/docs/ide/features/skills)

Bob 有 Actor/Critic 安全工作流教程，但需要配置规则、skills 和授权。生成的检查报告不是实际 SAST 结果，也不是独立安全认证。[安全工作流教程](https://bob.ibm.com/docs/ide/tutorials/generate-secure-code)

其 Rollback 保存任务中的工作区文件快照，有忽略文件等范围限制；不能回滚已写数据库或已部署生产系统。[Rollback 范围](https://bob.ibm.com/docs/ide/features/rollback)

**采纳：** 目标与验收先明确；子任务只传足够上下文；恢复要说明资源范围。现有 R3 已提供独立评审角色，不给每张小卡再加一次同质评审。

## 5. AWS：必须区分旧版缓存、主线和发布版

本次主线检查：[`aadc832354f2d8841489ed01b5e0d852b32b7962`](https://github.com/awslabs/aidlc-workflows/commit/aadc832354f2d8841489ed01b5e0d852b32b7962)。该提交来自已合并 PR #1097。检查时最新 Release 是 [v2.8.1](https://github.com/awslabs/aidlc-workflows/releases/tag/v2.8.1)，指向 `215afe1a61cb06e43002f5ace9ede10dfad80ed4`；主线比它新。下列能力基于所检查主线，不自动断言每项都在该 Release 中。

当前 README 描述 5 phases、33 stages、11 workflow profiles，以及跨宿主核心和 CLI。旧搜索缓存中的三阶段、Operations placeholder 描述不适用于这个主线版本。[固定版 README](https://github.com/awslabs/aidlc-workflows/blob/aadc832354f2d8841489ed01b5e0d852b32b7962/README.md)

| 核验点 | 有实现的部分 | 接入边界 |
|---|---|---|
| 身份与恢复 | intent/session 绑定；编排命令含 next/report/park/continue | 不理解本仓卡片/RED/ship 所有阶段的结果 |
| 按需阶段 | scope/profile、阶段选择、Construction 单元依赖/批次 | 仍需业务需求、产物生成及批准；不是任意需求全自动产品验收 |
| 状态与审计 | 持久状态、审计记录与恢复协议 | 阶段审计不自动覆盖本仓未接入工具或远端副作用 |
| Operations | deployment、observability 等条件阶段已存在 | 阶段协议不等于已配置生产凭据、部署 runner 和回滚环境 |

代码/协议依据：[编排入口](https://github.com/awslabs/aidlc-workflows/blob/aadc832354f2d8841489ed01b5e0d852b32b7962/core/tools/aidlc-orchestrate.ts)，[阶段定义](https://github.com/awslabs/aidlc-workflows/blob/aadc832354f2d8841489ed01b5e0d852b32b7962/docs/guide/04-phases-and-stages.md)，[状态和审计](https://github.com/awslabs/aidlc-workflows/blob/aadc832354f2d8841489ed01b5e0d852b32b7962/docs/guide/10-state-and-audit.md)，[部署阶段](https://github.com/awslabs/aidlc-workflows/blob/aadc832354f2d8841489ed01b5e0d852b32b7962/core/aidlc-common/stages/operation/deployment-execution.md)。

**采纳：** 可恢复身份、按影响选阶段、产物验收后推进和明确暂停/恢复语义。若将来需要现成引擎，优先做固定 Release 的适配验证；本轮不安装它，也不让它与现有卡片控制器争用状态。

## 6. specs.md：重点看 FIRE，但别将提示词当强制闸门

检查主线：[`c9c2ba8e80b809787d80a202ee394e1c5847dddf`](https://github.com/fabriqaai/specs.md/tree/c9c2ba8e80b809787d80a202ee394e1c5847dddf)；检查时最新发布标签：[v0.1.74](https://github.com/fabriqaai/specs.md/releases/tag/v0.1.74)。能力取自该主线源码。

README 提供 Ideation、Simple、FIRE、AI-DLC 四种 flow，安装时选择；Simple 偏规格生成，FIRE 偏自适应执行和既有项目。它不是本仓 T0/T1/T2 request router 的现成实现。[固定版 README](https://github.com/fabriqaai/specs.md/blob/c9c2ba8e80b809787d80a202ee394e1c5847dddf/README.md)

FIRE 使用自己的 intent/work-item/run 工件。真实脚本创建 run、核对 ID、记录执行阶段；执行指令按 current_phase 恢复，并定义 autopilot/confirm/validate 自治模式。具体审批与测试顺序有相当部分由 agent 指令表达，状态写入函数本身不等于不可绕过的权限边界。[run 初始化](https://github.com/fabriqaai/specs.md/blob/c9c2ba8e80b809787d80a202ee394e1c5847dddf/src/flows/fire/agents/builder/skills/run-execute/scripts/init-run.cjs)，[执行协议](https://github.com/fabriqaai/specs.md/blob/c9c2ba8e80b809787d80a202ee394e1c5847dddf/src/flows/fire/agents/builder/skills/run-execute/SKILL.md)，[阶段更新实现](https://github.com/fabriqaai/specs.md/blob/c9c2ba8e80b809787d80a202ee394e1c5847dddf/src/flows/fire/agents/builder/skills/run-execute/scripts/update-phase.cjs)

AI-DLC flow 另有工件格式和状态一致性工具；它们校验 ID、引用等结构，不能代替业务行为、路径范围或安全测试。仓库的 npm 发布流程发布的是 specs.md 包，不是自动替用户项目交付。[artifact validator](https://github.com/fabriqaai/specs.md/blob/c9c2ba8e80b809787d80a202ee394e1c5847dddf/src/flows/aidlc/scripts/artifact-validator.cjs)，[包发布流程](https://github.com/fabriqaai/specs.md/blob/c9c2ba8e80b809787d80a202ee394e1c5847dddf/.github/workflows/npm-package-release.yml)

**采纳：** 按风险调整确认频率、每个 run 有持久身份、只恢复缺失步骤。继续使用现有 task cards/plan_ref/depends_on；不引入第二套 memory-bank 或 `.specs-fire` 作为本仓权威。

## 7. ai-sdlc-framework：治理有代码，自治仍有实验边界

检查主线：[`a739ceceb3d68522404816bb21372cbb32da43b4`](https://github.com/ai-sdlc-framework/ai-sdlc/commit/a739ceceb3d68522404816bb21372cbb32da43b4)。检查时 GitHub 最新发布标签为 [ai-sdlc-plugin-v0.20.1](https://github.com/ai-sdlc-framework/ai-sdlc/releases/tag/ai-sdlc-plugin-v0.20.1)，目标提交 `a5d0c67793d0d5965b1bedfee3da7ebfa9109cdd`。这是多包仓库，不能把一个 plugin 标签当作所有组件的统一版本。

它是可执行多包框架，范围主要在已明确契约之后的执行与治理。README 将 Decision Catalog 标为 forthcoming/Draft，不能计入已实现能力。[固定版 README](https://github.com/ai-sdlc-framework/ai-sdlc/blob/a739ceceb3d68522404816bb21372cbb32da43b4/README.md)

| 核验点 | 代码证据与边界 |
|---|---|
| 调度/恢复 | loop 有就绪候选、in-flight 防重与残留 worktree 恢复；需 `AI_SDLC_AUTONOMOUS_ORCHESTRATOR=experimental` 才启动。不能把实验开关路径称作默认成熟能力 |
| Definition of Ready | 有实际就绪检查和测试；接入方仍需定义任务契约与策略，不能用它替代本仓 check-cards |
| 审计证据 | 有 DSSE 签名证据代码及状态存储；签名证明绑定内容与签署关系，不证明所有工具动作已被捕获或功能一定正确 |
| CI 反馈 | 有失败观察、分类和冷却机制；只覆盖限定修复类别，并依赖外部 gh/runner，不是通用 CI 自动修复 |

固定代码：[loop](https://github.com/ai-sdlc-framework/ai-sdlc/blob/a739ceceb3d68522404816bb21372cbb32da43b4/pipeline-cli/src/orchestrator/loop.ts)，[DoR gates](https://github.com/ai-sdlc-framework/ai-sdlc/blob/a739ceceb3d68522404816bb21372cbb32da43b4/pipeline-cli/src/dor/gates/index.ts)，[DSSE](https://github.com/ai-sdlc-framework/ai-sdlc/blob/a739ceceb3d68522404816bb21372cbb32da43b4/pipeline-cli/src/attestation/sign-v6.ts)，[StateStore](https://github.com/ai-sdlc-framework/ai-sdlc/blob/a739ceceb3d68522404816bb21372cbb32da43b4/orchestrator/src/state/store.ts)，[CI watcher](https://github.com/ai-sdlc-framework/ai-sdlc/blob/a739ceceb3d68522404816bb21372cbb32da43b4/pipeline-cli/src/runtime/ci-failure-watcher.ts)。

**采纳：** 开工前契约就绪、带身份的动作与恢复、证据绑定和有限自治。暂不作为三文件 skill 的直接依赖：其任务模型、策略、持久化和生命周期都需适配；某些修复采用 rebase 的路径也与本仓收据后的历史约束冲突。

## 8. 对计划的实际修订

1. 保留轻量三文件入口，按请求复杂度、变更面和风险选模块；不照搬全部厂商阶段。
2. 原有 plan-forge 负责规划/投影，task.ps1 负责交付；先补适配与现有入口一致性，不另造完整引擎。
3. 目标完成必须验收真实集成行为。数据迁移、权限、UI、性能和 LLM eval 由适用性触发，不能因任务叫“小 bug”而跳过。
4. 发布/监控作为已授权、已接线的可选生命周期路径；缺少必要能力就报告未完成，不能把 merge 当部署。
5. 将“有记录”“来源可追溯”“独立验证完整审计”分开报告。三文件版本若不具备最后一种能力，应保留 challenge 阻塞条件，不以更强提示词冒充实现。

工程上的发布健康检查与恢复条件另参照 [Microsoft safe deployments](https://learn.microsoft.com/en-us/azure/well-architected/operational-excellence/safe-deployments)。这些取舍是针对本仓的评估，不是厂商声称支持本仓集成。

## 9. 验证边界

已核验：官方资料、代表性实现及对应测试文件的存在、主线与发布版本区别、与本地规划/交付契约的冲突。未核验：这些外部框架在本机的安装、运行结果、真实权限边界、性能或完整审计效果。没有执行远程代码或新增框架依赖。
