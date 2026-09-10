# 另一场 Claude Code 会话方案评审

日期：2026-09-10。结论：**接受生命周期扩展方向；修订后再进入实现，不直接替换 v4。**

评审对象：[新附件](C:/Users/Admin/.codex/attachments/ada5e25a-196d-46c0-a451-440692ab73ad/pasted-text.txt)。对照：[评审时的 v4](D:/Projects/AIDLC/docs/plans/PLAN-aidlc-loop-v4-archive.md)。本次只做文档评审，没有实施 T311、调整 PR #394 或修改已安装的技能。

这版的主要进步是把发布、迁移、恢复和运维反馈写成按需加载的模块。主要问题是：新增模块仍是顺序步骤，缺少可恢复的动作记录；原 card/arc 循环中此前发现的若干问题仍未修复。文件数从三份增加到五份本身不是问题，真实加载量和恢复行为才是验收对象。

## 值得保留

- `release.md`、`migrate.md` 按需求和变更面加载；普通任务继续走轻流程。
- 缺失项目命令显示 `NOT CONFIGURED`，不能算成功；复用已有交付工具。
- staging 验证、恢复演练、生产授权，以及 schema/data 迁移的区别。
- R34g 区分“计划能力”和“经过运行验证的能力”。但一次成功 replay 仅能证明该场景，不能证明整个模块的故障恢复。

## 必须修正

### 1. P1：跨会话循环没有可靠的计时和停止依据

位置：[R11–R13](C:/Users/Admin/.codex/attachments/ada5e25a-196d-46c0-a451-440692ab73ad/pasted-text.txt:194)。

R13 规定 3 小时/卡、12 小时/arc，却没有保存首次开始时间的权威位置。R12 的 compaction 清单没有时间锚点；R28 的 board 又明确不是事实源。压缩、重启或换会话后，限制可能重新计时。R11 同时提到后台通知和唤醒，并直接使用未经当前宿主验证的 `noop:true`、`stop:true`。不能靠这些字段证明 DONE 后不会再次执行。

修订：沿用 v4 的持久化起点、父子截止时间、单一调度拥有者和终态检查；每种等待只使用一种完成通知方式。先核验安装版本的真实工具参数和取消行为。没有持续运行宿主时，明确只能自动执行到本轮结束。已发出的操作先查询结果，再决定重试或停止。

### 2. P1：审查仍可能先合并缺陷，重试次数也可能超标

位置：[R21–R25](C:/Users/Admin/.codex/attachments/ada5e25a-196d-46c0-a451-440692ab73ad/pasted-text.txt:210)。

advisory 模式若已由 ship 合并，技能事后读取 block 就无法落实“本次 diff 的真实缺陷先修复”。只数 `success + block` 文件也不等于实际审查调用数；同一文件可能覆盖，脚本内部可能已经重试。R23 再跑 ship 可能重复内部的一次重试。R24 则对所有 CI 失败一律 rerun，包含应修代码的确定性失败。R25 没有 issue 创建幂等性或 CLOSE 补齐流程。

修订：自动合并前必须有可执行的缺陷阻断机制；不存在时停止该自动路径，不擅改项目默认策略。分别记录实质裁决、阻断次数及脚本计数；driver/script 合计只拥有一次 no-verdict 重试。CI 先分类，只有有依据的暂时性故障才 rerun。创建 issue 前后对账，CLOSE 可恢复未完成的登记。

### 3. P1：卡片完成仍可能被误报成需求完成

位置：[R6](C:/Users/Admin/.codex/attachments/ada5e25a-196d-46c0-a451-440692ab73ad/pasted-text.txt:178)、[R29–R34](C:/Users/Admin/.codex/attachments/ada5e25a-196d-46c0-a451-440692ab73ad/pasted-text.txt:222)。

T1 没有 arc 整体验收；R32 以所有卡 merged/closed 判 DONE，R33 仅为 T2 加 VERIFY-ARC。两张卡分别通过测试，组合起来不能完成用户流程时，仍可能 DONE。`allow_paths` 不重叠也不能证明数据库、端口、外部环境没有冲突；两个 worker 运行时，lead 再 PREPARE 下一张卡还可能形成第三个执行者。

修订：所有多卡需求都要验证最终集成产物上的用户验收；按风险选择测试，不机械跑全仓。混合变更取适用检查的并集。只有所有权和共享资源隔离均成立才并发，否则串行。lead 不额外启动超出并发额度的写入。修复按共同原因组成卡，并保留原 arc 的截止时间和修复次数。

### 4. P1：发布没有恢复状态，授权和证据未绑定制品

位置：[R34b–R34d](C:/Users/Admin/.codex/attachments/ada5e25a-196d-46c0-a451-440692ab73ad/pasted-text.txt:233)。

部署调用超时并不意味着没有部署。方案缺少 release identity、候选 digest、目标环境、操作 ID 和已完成步骤的查询规则；重入可能再次 tag/deploy。标签在 staging 验证前生成，且未区分本地 tag、push tag 和发布对象；如果实际动作触发生产 CD，会绕过后面的 release-auth。`pre-approved: rollback` 也没有限定环境、版本、触发条件和迁移兼容性。

修订：复用项目发布系统保存上述状态；恢复时先查事实，不盲目重复有外部效果的命令。部署/状态/恢复命令必须区分环境和候选制品。检查 tag/release 的触发效果；会发布到外部的动作纳入对应授权。生产授权绑定具体候选和环境；回滚权限限定触发条件与恢复目标。改变制品或目标后重新判断授权适用性。

R34c 的默认 10 分钟只是时长，尚无 soak 的指标来源、阈值、最小样本和缺数据处理；不能以“等了 10 分钟”判 `ok`。回滚表示原发布尝试失败或已恢复，修复卡合并不代表发布目标完成。修复后的候选要重新进入验证和发布流程。

### 5. P1：迁移没有真正接入发布顺序和恢复条件

位置：[R34a、R34c、R34e](C:/Users/Admin/.codex/attachments/ada5e25a-196d-46c0-a451-440692ab73ad/pasted-text.txt:232)。

只检测迁移目录会漏掉 ORM 定义、内嵌 SQL、脚本或基础设施引起的数据变化。R34e 说生产 apply 在 release gate 内，但 R34c 没有 apply、backfill、兼容性验证或失败分支。若按 R29 要求所有 schema 卡最先合并，contract 卡也可能提前执行。要求 down migration，同时允许 irreversible，却又一律要求 DoD 跑 down，形成冲突。

修订：按数据影响识别迁移；以显式依赖和环境步骤表达适用的 expand → compatible deploy → backfill → verify → contract。contract 必须等待消费者兼容及验证，不能因属于 schema 而最先执行。可逆迁移验证 up/down 和数据不变量；不可逆迁移选择明确的恢复/前向修复方案。scratch 数据库演练不能自动充当行为 RED。

staging 恢复演练与生产恢复点分开验证。生产 apply 前，确认对应生产库的恢复点、时间和可用权限。应用回滚不能假定同时撤销数据库变化。迁移状态 UNKNOWN 或失败时先对账，不能继续 DONE。

### 6. P1：目标仓库和工具版本尚未对齐

位置：[R7](C:/Users/Admin/.codex/attachments/ada5e25a-196d-46c0-a451-440692ab73ad/pasted-text.txt:190)、[R15–R20](C:/Users/Admin/.codex/attachments/ada5e25a-196d-46c0-a451-440692ab73ad/pasted-text.txt:202)。

本次复核 MyInspection HEAD 为 `e56b00fd2ac4eeade7eec86d0e17a756fbfc734f`：

| 附件假设 | 当前下游事实及影响 |
|---|---|
| `verify.ps1 -Strict`、通用 `E2ECommand` | [verify.ps1](D:/Projects/MyInspection/scripts/verify.ps1:20) 没有声明 Strict 参数，gate 2 是项目指定的 Golden Evidence JVM Core E2E。不能据通用模板推导当前能力。 |
| `.review/<branch>.r<N>.json` | 当前 [review.ps1](D:/Projects/MyInspection/scripts/review.ps1:115) 使用分支 verdict 文件及独立 `.rounds`；按附件路径读会找不到证据。 |
| 没有 TASK-RESUME 时把 existing-worktree 报错当成功恢复 | [task.ps1](D:/Projects/MyInspection/scripts/task.ps1:319) 的存在性报错不证明工作树身份、分支或所有权匹配；需核实后 attach。 |
| 只提交失败测试，然后 ship | 当前 [task.ps1](D:/Projects/MyInspection/scripts/task.ps1:430) 需要 controller 的 RED 收据；正常行为卡不能省略。合法非 TDD 卡则有显式豁免路径，不能一概 STOP/card。 |

附件可能面向另一版上游；这不证明上游实现错误，但必须固定上游提交、下游版本和兼容前提。未合并 PR、T302/T309 等能力不能当作所有项目已安装的能力。T0/T1 是否可免规划确认，也要与实际路由/签核政策对齐。

### 7. P2：动态输入和变更处理仍不完整

位置：[R1–R5](C:/Users/Admin/.codex/attachments/ada5e25a-196d-46c0-a451-440692ab73ad/pasted-text.txt:158)。

所有 bug、issue 和日志都归 T0，会把范围未知或影响认证/数据的缺陷误判成小任务。卡 ID 也不代表小任务；项目 `ProjectTier` 与单次请求规模不能混用。旧卡只写了 edit，没有区分未开工、执行中、已合并，亦未处理新需求使当前计划失效的情形。

修订：保留 v4 的影响与风险分类、明确仓库/ID、旧卡状态分流和有版本的需求修订。运行中的卡先核实已产生的效果；已合并卡保持历史，由后继卡实施新需求。用户仅要求修改卡文案时，不自动扩大到代码实施。

## 调研与验收结论需要收窄

附件第 115、355 行的“所有参考来源都没有可执行的合并后能力”过强。IBM DevOps Deploy 是实际的发布自动化产品，具有部署自动化及审计功能；它当然不等于已为 MyInspection 配置好，但不能归为只有提示词。[IBM 产品说明](https://www.ibm.com/products/devops-deploy?lnk=flatitem)

附件的 Anthropic 迁移行称文章没有 schema、migration、health 等文本，也不准确。原文包含 schema 示例、迁移编辑约束、按环境限定的部署/状态/回滚工具及运行指标触发恢复。正确结论是“文章不提供可直接装入本项目的通用数据库迁移引擎”。[Anthropic playbook](https://claude.com/blog/the-ai-native-sdlc-playbook)

ai-sdlc 的 Decision Catalog 在此次读取的 README 中仍标为 forthcoming / Draft；若表格要标 implemented，需给出对应实现与验证路径。不要把同仓库中已实现的 DoR 自动扩展为整个 Decision Catalog 已完成。[项目 README](https://github.com/ai-sdlc-framework/ai-sdlc#the-five-pillars)

R46 只有一个 T0 和一个 T1；它们不能验证 T2 规划、发布、迁移、重启恢复或性能中位数。T311 的文本存在性/长度检查只验证包装，不证明自动循环行为。应增加与声明对应的代表性场景：

| 能力声明 | 必须观察的结果 |
|---|---|
| 持续循环及终止 | 压缩/重启后截止时间不重置；迟到唤醒不重启 DONE/STOP 工作。 |
| 缺陷与审查 | block 先于 merge 生效；no-verdict 总重试不超额；重复恢复不重复建 issue。 |
| 多卡交付 | T1 集成失败不会 DONE；需求修订保留已完成效果；无资源隔离时串行。 |
| 发布及恢复 | 丢失部署响应先查状态；制品改变不能沿用不适用的授权；缺健康数据不算成功。 |
| 迁移及 challenge | 迁移中断可对账，生产恢复点独立验证；完整审计需要独立核对事件和证据覆盖。 |

如果仍保留用户给出的 challenge 要求，R34g 不能把“fully audited”从目标中删除后就视为满足。应保留资格验收：需求、决策摘要、动作、风险判断、授权、工具结果和最终环境证据可追溯，并验证记录没有缺失；不需要暴露模型隐藏思维过程。

## 建议的合并方式

保留 v4 的循环、恢复、证据和整体 DONE 条款；吸收本版的两份按需生命周期模块，并先补齐上述发布/迁移合同。能力不足时列明依赖已有工具的前提，不用新增文字冒充已存在的执行保障。分开验收“技能包装”“循环行为”“项目发布/迁移接入”，不把一次 T311 文本检查等同于全部完成。

本次验证为附件全文审查、当前仓库接口检查及针对性官方来源核对。没有进行运行 replay，当前 canonical v4 保持原样。
