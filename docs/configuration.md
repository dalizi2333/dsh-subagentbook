# 配置与服务

`Config.bookJson` 接收 version 1 的 JSON 文本，使用宿主 volatile 配置更新。通过设置服务保存时，书结构、provider 命名冲突及当前可用路由的预算/思考档位在写盘前验证；陈旧 revision 拒绝覆盖。更新角色目录不停止已有活跃实例：原会话继续使用其编译快照，后续新建实例使用新定义。配置来自 owner，工具调用只能选择其中已声明的角色和精确模型，不能提交任意插件代码或提高深度。

```yaml
- id: subagentbook
  config:
    bookJson: '{"version":1,"entryPresets":[],"presets":[]}'
- id: promptbook
  config:
    autoInject: false
```

书为空时不向模型暴露委派工具，保存非空书后即可启用。非空书使用 `llmMimo.listHostedModels()` 的 `(provider, id)` 目录；角色中 `model` 对应目录的 `id`。采用 Promptbook 时需要支持 `autoInject: false` 的版本；它保留文案解析和编辑服务，自动 Persona/tool 注入由本书接管。该模式同时影响此 profile 的根会话：选择书内角色时由本书装配，其他根会话仍由其原生预设提供 Persona。

## 管理界面

插件详情页中的管理卡选择角色，再选择公共配置或精确模型变体。模型覆盖按顶层字段替换；“使用公共配置”删除当前覆盖，明确保存空数组/深度0则保留其含义。切换作用域保留草稿。行内和底部保存按钮提交当前全部草稿；保存失败保留草稿和原生效书。遇到其他编辑者更新导致的冲突，可以检查草稿后明确放弃，再以最新定义重新编辑。

标题行角色名是关系图的展开入口，取代角色下拉菜单和独立关系图按钮。图与标题共享展开卡片，首个配置分组按标题展开状态重算圆角。图展示当前编辑书的有向委派声明，包含已确认的草稿字段。公共视图读取公共字段，精确供应商/模型视图按顶层覆盖解析；缺此路由的角色不提供出边，入边/节点以虚线标识，点击进入其公共配置。节点选择后收起标题展开区，进入对应角色/作用域，沿用编辑器的草稿保留和整书保存门。布局容纳循环、自委派、共享子角色和孤立节点；图中列距仅用于布局，不是运行深度。悬停节点查看ID、工具、文件权限、局部深度及委派名单，已有实例仍在实例配置中查看原始快照。

循环诊断为非阻断警告。强连通分组（含单节点自环）的节点/内部边用琥珀色标识，共享子角色不误报。标题警告读取公共与各模型关系并集，点击打开明确标为“可能关系”的合并视图；它也能发现不同模型变体拼出的潜在循环，不声称这些边属于同一个模型或必定可执行。边提示列出其公共/精确模型来源，分组内角色按钮直接选择并展开委派字段，方便修复。精确模型视图仍仅诊断该视图，显式空覆盖保持无边。诊断不写书、不生成schema错误、不阻止保存，也不改变运行时的深度、权限或委派快照。

新增角色/模型变体的表单锚定实际点击按钮，采用非模态浮层。根据按钮上下可用空间定位并在视口内限宽限高，模型选择菜单显示在浮层之上；取消/外部点击/Escape关闭，Escape优先关闭模型菜单，显式取消或Escape把焦点还给按钮。未确认输入在同次编辑器会话中保留，不提前修改书。重复ID/模型变体等失败留在浮层提示；成功新增角色后展示公共关系图、定位并聚焦新节点和显示“已添加”，仅代表加入当前草稿，保存后反馈消失。新增模型变体则回到标题的模型配置选择。新增角色不创建任何额外委派边，既有草稿与整书保存门保持。

指示灯同时反映当前字段状态与来源：当前作用域明确保存值为绿，继承已保存公共值为黄，内置默认/未保存改动/待确认输入为灰；无效输入或保存失败为红，保存中动态显示。hover/辅助标签区分具体状态。行内保存只在本行确有变化且整份草稿可提交时亮起，悬浮说明“保存全部草稿”；书结构或任意输入有问题时禁用。撤销只恢复本行可撤销的覆盖或输入，不撤销其他行/公共配置的修改；返回原值后不保留空草稿，按钮同步熄灭。保存期间阻止重复提交，完成后灯态和按钮按实际持久结果更新，失败不伪装成已保存。

工具使用偏好和嵌套深度采用行内编辑：直接点击值打开菜单或短输入框，保存/撤销与模型继承操作在同一行右侧按hover、键盘焦点或改动出现。深度Enter结束编辑，仍需保存；Escape恢复进入这一次编辑前的值及覆盖关系，包括先前未保存的草稿，Tab/失焦保留输入。无效深度就地提示并阻止保存。其他字段继续展开编辑，简单项不会另外拆出展开卡。

当前卡支持角色信息/根委派入口、Persona与偏好文案引用、工具名单、使用偏好、文件权限、委派名单和局部深度。工具教学不在本卡编辑，使用Promptbook对应键；插件组合配置已移除。预算/思考采用图形控件，额外请求字段使用点分路径和值编辑。编译预览与宿主共用结构、配置及模型能力解析代码，文案引用和工具教学通过Promptbook镜像重放；它不验证组件加载、实际工具存在、权限执行或模型表现。缺路由/文案显示错误；暂时不可用的路由仍可保存供修订，但不能启动。

工具名单使用标签编辑：输入工具名并按Enter确认，支持逗号或空白分隔的一批名称；整批校验通过才添加标签。未知或重复工具保留输入并提示，不会部分加入；每项可独立删除，删除全部表示显式空名单。待确认输入按角色/模型保存在会话草稿中，阻止任何行保存整份草稿；确认或清空后恢复保存，撤销本行、使用公共配置或放弃草稿会清理相应输入。Enter仍须之后保存才持久化；组字中的输入法Enter不提交工具。

## 定义

[示例](../examples/book.json)展示同一逻辑角色在 Flash 和 Pro 上使用不同工具和插件。它是结构示例，实际名单应按任务实验选择。供应商 ID 必须改成目标 profile 的真实路由。

- `entryPresets`：根或书外 Agent 可选择的子角色 ID。
- `presets[]`：`id`、`name`、可选 `description`、公共 `defaults`，及非空 `models[]`。
- `models[]`：精确 `provider` + `model`，以及可选 `overrides`。覆盖按顶层字段替换；数组整体替换，不逐项合并。
- `persona`：`{text: "…"}` 或 `{key: "Promptbook键"}`，恰选一种。最终 Persona 不能为空。
- `tools`：目前支持八件套的准确名称：`bash/glob/read/grep/edit/write/web_search/web_fetch`。其他工具须先扩展固定组件映射，当前明确拒绝。委派入口由`delegates`管理，不能在此填写原生或书内委派/消息/停止工具；书内自动管理这些生命周期入口。
- `delegates`：此角色可选择的下级角色 ID；默认 `[]`。与工具可用性无关，父角色可获准委派一个具备不同工具的角色。
- `maxNestedDepth`：本角色还能派生的代数，非负安全整数。0 能工作但不能再派生，省略继承祖先约束。
- `toolPreference`：`free`（默认）或 `bash`。选 bash 还需声明 Bash 可用并提供 `preferencePrompt`（`{text}` / `{key}`）。偏好与工具名单、教学分别选择。
- `agentOptions`：可选 `maxTokens`、`reasoningEffort`。此字段整体覆盖公共配置。预算和思考档位按目标模型确定，即使父子路由相同也不继承父角色的选择；省略预算采用模型目录广告的默认值，省略档位交给目标适配器的默认映射。
- `actionScope`：`inherit` 沿用上级，`read-only` 收紧为只读，`verification-copy` 由可写父级直接委派独立验证副本；GUI提供“文件权限”选项。缺少执行能力时拒绝受限实例。继承快照用于父级撤权校验，有效子级策略按冻结角色推导并写入原生会话；后续消息、后代和冷恢复不能扩权。验证副本的输入/工作区/留档契约见[专门文档](verification-workspaces.md)。该项不是禁网或任意OS隔离开关，工具名单和Persona不能替代权限。父级若使用与宿主不同的私有执行/权限 realm，当前明确拒绝委派，避免回落到权限更宽的宿主执行器。

## 固定工具组件

子实例按`tools`装配官方组件，无需在预设配置插件，也不能逐角色设置组件参数、启停、隔离标签或分组。

| 声明工具 | 固定组件 |
|---|---|
| bash | `@deepseek-ai/dsh-tool-bash`，后台执行与超时转后台均关闭 |
| read / edit / write | `@deepseek-ai/dsh-tool-fs` |
| glob / grep | `@deepseek-ai/dsh-tool-fs-search`，`sampleOverCapGlobResults:false` |
| web_search / web_fetch | `@deepseek-ai/dsh-tool-web` |

只装配实际需要的组件；空工具名单不加载任务组件。组件提供的其他工具仍被声明白名单和执行守卫屏蔽。内部`compiled.plugins`是从工具声明计算的只读执行记录，用于代码指纹和恢复，不是书定义字段。恢复须符合原固定映射及代码版本，否则拒绝，不切换为最新预设。

宿主必须提供llm-mimo和Promptbook服务；缺失拒绝编译/新建/继续，Promptbook须为`autoInject:false`。空书仍可安装并打开配置入口。FS/shell/sandbox/审批与深度沿用宿主真实约束。此处没有任意插件白名单/黑名单，也不屏蔽其他宿主插件的全局上下文改写；这些插件由profile管理。

旧`plugins:[]`读取时归一化移除；任何非空旧组合均明确拒绝，包括disabled行。先备份旧书，核对其参数、额外能力及上下文效果，再移除各defaults/overrides中的plugins字段，采用本节固定组件。需要自定义组件或参数的旧角色不能直接等效迁移，须在宿主安排或等待明确的功能支持；插件不猜测、自动继承或静默丢弃旧选项。旧会话仍受执行代码指纹变化的拒绝规则约束。

## 工具教学归 Promptbook

书定义只声明工具，不携带工具教学文本或引用。Subagentbook在Promptbook可用时注册下列9个键，已有注册定义及本地化编辑保持不变；没有Promptbook拒绝运行书实例。服务存在但没有本地化命中时保留原生描述。

| 任务工具 | Promptbook键 |
|---|---|
| 多工具组合中的Bash | `tool.bash` |
| glob / read / grep / edit / write | `tool.glob` / `tool.read` / `tool.grep` / `tool.edit` / `tool.write` |
| 网络搜索/抓取 | `tool.web_search` / `tool.web_fetch` |
| `tools: ["bash"]` | `tool.bash.only` |

纯Bash按任务工具名单判断，不受`toolPreference`影响；自动加入的委派/消息/停止工具不改变选择。可用其他任务工具时，Bash仍用普通键，即使偏好Bash也不会换成纯Bash教学。自定义工具透传，不猜对应教学键。

教学按Promptbook的模型→供应商→default层序解析**本地化命中**（`resolveOverride`），注册fallback只是基线DSH描述摘录，供卡片展示，不触发改写。纯Bash专用键没有命中时再查普通`tool.bash`；两个都没有命中则保留当前工具插件的实际原生描述，包括其动态配置。命中空字符串表示退出接管，透传原生，不把描述清空；专用键显式空白也不继续查普通键。只替换description，不改工具名称/参数schema、系统工具政策或执行权限。

解析结果及所选/命中键保存在编译快照的`teaching`和`sources.teaching`，它们是只读运行结果，不是书定义的配置字段。新建实例读取当前Promptbook编辑；已有实例、续聊及冷恢复保持原值。修改Promptbook或删角色不会给原会话换教学。预览重放相同规则，但不代替实际wire验收。

旧书的空`teaching: {}`会在读取时归一化移除。非空旧映射明确拒绝：先保存原文/引用，按原精确模型和工具名单把文字迁到上述Promptbook键，再删除旧字段。不同角色在同模型上已有不同文字时不能自动覆写共享键，需先决定保留哪份；插件不会静默丢弃或猜测迁移。保留原记录用于审阅。旧执行代码变化的会话仍受既有artifact指纹拒绝规则约束。

## 模型能力准入

预算卡的小`+`可以加入额外请求参数，直接填写API文档中的`thinking.budget_tokens`等点分路径。每行有可选显示名、API格式、数字/文字/布尔类型及值；数字可配置滑块最小/最大/步长。范围是用户设定的控件约束，不代表服务端能力。点行名再次编辑设置，`×`移除整项，再保存草稿。预设内的形态为：

```json
{ "agentOptions": { "requestFields": [
  { "name": "推理预算", "apiFormat": "chat", "path": "thinking.budget_tokens",
    "type": "number", "value": 8192, "min": 0, "max": 32768, "step": 1024 }
] } }
```

这是自定义字段的结构示例，不是声明所有Chat/MiMo端点支持此参数。控件不会猜测API格式或预算含义。公共配置须有同格式的继承模型；不同格式请在模型变体分别配置。格式更换后旧字段保持原值并拒绝运行，要求明确迁移。保存及续聊/恢复/请求前重查；只在该书实例的精确session和路由生效（包括书内根会话），不注入其他会话或标题/压缩辅助调用。新预设不热改原实例参数快照。

相同根的不同字段会合并成对象，例如已选思考档位的`thinking.type`与额外`thinking.budget_tokens`。同一路径或父子路径碰撞明确拒绝，包括与已选思考档位的碰撞；可先将该档位恢复默认，再自行配置字段。模型/消息/系统提示词/工具/传输字段及输出上限是受管理字段，不能用这里绕过；输出上限继续用既有控件。自定义temperature可替代连接默认值，但不能覆盖显式标准选择。未配置任何额外字段时保持原行为。需要llm-mimo广告`requestFieldsVersion:1`及`registerRequestFieldSource`；不会静默丢弃不支持的字段。

预设卡的“预算与思考”是每次调用的输出上限与思考档位，不是整场任务总预算。输出上限可拖动滑块或精确输入正整数；清空数字/点击“模型默认”移除预算选择。内置思考可按显示名或滑块选择，内部仍保存目录中的稳定ID；这些档位的请求路径与值由llm-mimo模型设置维护，hover可查看其`xxx.xxx = value`映射，无需手写嵌套JSON。两个选项独立修改并保留另一项，但书中的`agentOptions`仍为整字段覆盖；模型变体的“使用公共配置”恢复整个字段的继承。选值后仍需保存草稿。

公共配置的控件只计算当前继承`agentOptions`的模型路由，显示共同档位与最严格的已知上界；不采用首个模型的独有能力。若部分模型上界未知，滑块不可用但数字仍可输入；模型默认预算不会变成上界。缺失路由、无共同档位或没有继承者时就地提示，可切换具体模型变体。目录变化造成失效选值时保持原值并标红，要求重新选择/恢复默认；它也不能借由其他行保存而绕过校验。已有实例的编译快照不变。

`maxTokens` 必须为正安全整数，不能超过已知上下文容量或明确声明的输出上限。模型默认预算不是硬上限；未声明输出上限时允许选值，编译结果的 `capabilityCheck.warnings` 标明验证边界。该检查不保证完整输入加输出一定能装入上下文。

显式 `reasoningEffort` 必须是精确路由当前 `reasoning.efforts` 中的 opaque ID，不能填写显示名或其他 API 格式的 ID。llm-mimo 的 `validateAgentOptions` 进一步校验当前请求映射。保存、实例创建及发布、冷恢复、每轮请求/工具执行前都重查当前能力；目录变化使旧选值失效时在执行前拒绝。已有实例的角色快照不会因目录更新而自动换成另一档位。

## 根角色选择

宿主提供 `agentPresets` 时，每个书内角色注册一个原生预设，稳定 ID 为 `subagentbook-root:<base64url(roleId)>`。菜单只选逻辑角色，模型继续使用原生选择器；`entryPresets` 仍只控制书外 Agent 的子角色准入，不筛选根菜单。首次真实提示词装配取得最终 provider/model 后，才编译并持久化 `mode: "root"` 的原始实例。被动预览不创建快照；首次不支持的路由也不创建快照，修正模型后可重试。

原生预设预装该角色模型变体所需官方工具组件的并集，独立 marker、完整 Persona 模板及执行守卫先于请求存在。首次装配将声明/教学收窄到精确模型，实际执行也使用同一白名单；其他变体的工具不能通过伪造调用执行。只读角色进一步收紧原生文件/Bash权限及审批，并刷新本轮运行环境描述。根不消耗子代理层级：depth 为 0，ceiling 为 null，直接子级从 1 开始；根不应用角色的子级 `maxNestedDepth`，只服从 DSH 实时 `maxDepth`。

首轮成功准备后，角色、模型、文案、工具、预算和额外请求参数保持快照。原生选择器后续改模型会在发送前拒绝；要换模型请新建会话。角色预算/思考优先于原生选择器，未配置时使用目标模型默认。根的 workspace 与有效权限同样固定，修改后必须新建会话。书内根支持原生续聊、停止、持久化、冷恢复和向书内子级委派；实例面板显示“根会话”及 0 层。

根恢复先由原生 setup 重建预设与模型选择，再在 factory 发布前核验原 sidecar、固定工具映射、代码指纹、原生身份、权限及工作区；不从最新书或 Promptbook 重编译。删除角色时，从原始快照保留标注“历史会话”的预设，仅允许恢复；新建会在编译时拒绝。根记录缺失/损坏、代码或权限变化、服务卸载均拒绝，不回落普通 Agent。原生 fork 目前没有原快照迁移桥，明确拒绝；不要用复制历史的方式创建书内新根。

## 子级委派与深度

“可委派角色”与“可用工具”共用标签交互：输入书内精确角色ID，Enter整批校验，确认后呈现角色名称标签，hover可查看ID，×删除整项；确认后仍需保存草稿。未知/重复角色保留输入并提示，未确认内容按角色/精确模型单独保留并阻止整书保存，不能从别的行绕过。撤销、恢复公共配置、删除模型变体或放弃草稿会清理对应待确认输入。已有角色被删除时，引用标签显示失效并拒绝保存，须删除引用或撤回角色删除。持久数据仍是delegates的ID数组，显式空名单有效，不改变深度、权限或既有实例的委派快照；不在编辑器额外禁止自委派或跨模型角色。

模型调用 `subagentbook({preset, prompt, label?, provider?, model?, background?})`。provider/model 应一起提供；省略时沿用当前父路由。没有精确变体或模型目录无该路由时明确失败。子代理只收到此任务，模型/插件/Persona 固定到实例；完成后释放运行资源，保留记录。

根深度由 DSH 的实时 `maxDepth` 控制。书内保存祖先形成的绝对上限 C：每代 depth 加 1，准入要求 `depth <= min(DSH maxDepth, C)`；当前角色 N 将 C 收紧到 `min(C, depth + N)`。增大根限制或改后代模型不能放宽有限 C。异步准备结束后重新检查根限制与父权限；变化使过期创建失败，可重新委派。

默认前台 one-shot：等待结果，取消工具调用或卸载书会停止并回收实例；失败/输出上限/拒绝以工具错误返回。

`background: true` 创建持续会话，返回 `{childId, messageId}` 时表示首条消息已入 inbox，执行在后台继续。`subagentbook_message({sessionId, message})` 向自己的持续直接子级发送后续消息，或由持续子级向直接父级报告；`sessionId` 使用创建返回的 `childId`。`subagentbook_stop({sessionId})` 中断直接子级的当前任务，保留历史以便以后继续。DSH 自动将结束状态和最后文本通知仍在线的父级。接收回执不代表任务完成；模型/运行失败由原生结束通知和会话状态表示。

后台模式的 caller signal 只管入 inbox 前的启动；接受后由原生 manager 拥有，取消原工具调用不会撤销已接受的任务。停止使用上述入口或原生 UI；卸载书收拢书内活跃子级；父 Agent 真正销毁时关闭其原生继续准入并收拢后台分支，完成通知不会再启动正在关闭的父级。前台父角色的 handle 释放也会停止其后台子级；需要跨回合/重启继续的父链应使用持续模式。并发数量沿用 DSH `maxActiveSubagents`，嵌套深度另由 H/C 管理。叶角色仍能报告和接收消息，即使不能再委派。

## 程序接口与记录

消费方 `inject: ['subagentbook']` 后访问 `ctx.subagentbook`：

```js
const run = await ctx.subagentbook.start(parentAgent, {
  presetId: 'worker', prompt: 'Implement this small task.',
  provider: 'mimo', model: 'mimo-v2.6-flash', signal,
});
try { const result = await run.result; /* output, stopReason */ }
finally { await run.dispose(); }
```

`listPresets()` 返回逻辑角色和允许的精确模型；`compile(id, provider, model)` 返回冻结的解析结果；`instance(agent)` 返回活跃书内实例；`readInstance(sessionId)` 读取持久记录。前台程序调用者必须在使用结束时 dispose handle。后台调用 `startContinuable(parent, request)` 返回原生 `{childId, messageId}`，不持有 run；使用 `sendMessage(parentOrChild, targetId, text, {signal?})` 与 `interrupt(parent, childId)` 控制。

`definition()` 返回冻结的当前书；`preview(candidate, id, provider, model)` 在宿主模型目录与 Promptbook 服务上解析候选定义，不创建实例。`validateBook` / `updateBook` 是可信配置接线的内部方法，后者只更新运行时，不是持久化保存入口；用户配置走宿主设置服务并携带 revision。删除角色不替换已有快照；原实例允许的下级集合仍受原快照与当前角色可用性共同约束。

书内 revision、解析来源、已解析文案、插件配置、depth/C 与权限来源保存在 `DSH_HOME/subagentbook/instances/<id>.json`。不要放内联密钥；插件配置使用 credential ref。持续记录还保存最终 Agent options、权限默认值、执行代码指纹及完整性校验。子 Session 使用原生 descriptor/catalog；one-shot 历史只读，持续会话使用原生消息和停止 UI。不能混入基线无法恢复读取的自定义事件。

## 恢复

持续会话由原生 manager 在后续消息到来时按需冷加载，书内桥接在未发布 setup 恢复原快照。已有 Persona/教学、模型、预算、插件配置和 d/C 保持创建时值；最新书或 Promptbook 文字不替换它们。H 降低限制新派生，不禁止同代继续。新派生仍要求角色在当前书中可用。

恢复要求准确在线的直接父级、相同权限来源与工作区、仍存在的精确模型路由、未改变的执行代码。指纹覆盖启用插件包、声明的运行依赖、书运行实现与宿主 runtime；包内脚本、JS/TS、JSON/YAML、CSS/HTML、WASM 和原生模块/库 参与核验，开发文档/log/test 等不参与。代码变化时拒绝恢复，当前不归档旧安装包。自定义 `cordis:` builtin 按导出实现核验，不能承诺还原其进程外部闭包状态；持久状态应由插件自行保存。

缺失/损坏记录、代码变化、模型路由缺失、父级/子级权限变化均拒绝或在执行前失败，不猜最新配置。浏览器向活跃子级投递可能先得到 inbox 回执，再因权限或模型固定约束失败；这不代表模型请求已发送。取消/崩溃时的未完成 turn 与 inbox 由 DSH 原生恢复规则处理，不承诺外部副作用恰好一次。

one-shot 记录继续只读，不能升级为持续会话。书内根会话使用上文的根恢复契约；运行中换模型仍拒绝，插件组合配置已移除。

## 实例配置与保存诊断

书内根与子会话页顶部按需展开的实例配置，使用宿主认证Remote通道读取原始实例记录，逐字段投影；不传输供应商连接、凭据或完整插件配置。显示固定路由、任务工具、原权限/审批/工作区、深度/分支上界、预算/思考及Persona。根尚未发送第一条消息时提示快照待创建。书已变化只作提示，不重新编译旧实例。该读接口不恢复Agent，不修改记录，不发起模型调用；缺失/损坏不能回落最新预设。

保存仍通过原生settings.mutate与配置校验、原子持久化、revision fence；客户端经公开共享mirror接受Host结果。拒绝时显示原始原因并恢复Host视图，草稿及原fence保留。Conflict不自动重基或无条件写入；其他编辑器仍受Host同一冲突检查。


## One-shot delivery and paged results

A successful `subagentbook` one-shot call saves the child's final **text** in `DSH_HOME/subagentbook/reports` before disposing it. Reasoning remains in the original native child session and is not copied into the parent delivery. The tool returns `sessionId`, `stopReason`, a bounded `output` text preview, and `report: {sessionId, sha256, totalChars, offset, nextOffset}`. A non-null `nextOffset` means more delivery text must be read before treating the preview as the complete report.

Call `subagentbook_result({sessionId, offset: report.nextOffset, sha256: report.sha256})` repeatedly until `nextOffset: null`. Each response has `{sessionId, sha256, totalChars, offset, nextOffset, text}`. Saved JSON is limited to 32 MiB and is published atomically without overwriting an existing result. Offsets count UTF-16 code units; use returned offsets rather than guessing line numbers. Default/maximum page size is 4000, and an optional integer `limit` from 1 to 4000 can request a smaller page. Pages preserve Unicode characters. Concatenating the preview and following `text` fields reconstructs the saved delivery; the SHA-256 is over the full UTF-8 text. No host temporary file needs to be read.

Only the original live direct parent may read a one-shot child's saved result. Each call checks child ownership, original inherited permission policy, file identity and content integrity. A disposed child does not remove the result. After a host restart, a successfully restored parent can read it, even if the role was removed from the current book. Changing parent permissions, guessing another child's ID, traversal, missing/corrupt results or a mismatched expected hash fails explicitly. A historical child created before this result store existed has no saved result; there is no silent reconstruction from latest prompts. This reader does not resume a child or issue model requests. Continuable/background conversations retain their existing native message/completion path and are outside this one-shot result contract.

The application API `start(...).result` retains the full text `output` for trusted host consumers, plus page metadata; the model-facing tool bounds its preview. Both exclude reasoning. A saved report or `completed` status still does not prove tests passed. Final delivery text is evidence, not authority.

The delegation catalog describes file permission behavior for every exact model variant. `verification-copy` means the host has already made an independent Git copy: the child must build/test in its supplied workspace, not create another copy under the source. It requires a writable direct parent. These descriptions never replace runtime permission enforcement.
# Execution status

The instance configuration panel shows the execution status separately from the frozen role configuration. Public native `subagent/start` / `subagent/end` events are recorded in a separate `subagentbook/activity/<sessionId>.json` sidecar, paired by activation `runId`. A late result from an older activation cannot finish a newer one. These records do not alter composition snapshots, permissions, or continuation ownership.

Only a live Agent can establish that work is running. An unfinished persisted turn alone is unconfirmed; a server process being alive proves nothing about an individual child. An execution marked completed is not proof that its review report or implementation passed acceptance. If the native runtime provides only `error`, the UI retains that limit instead of inventing a crash cause. Historical instances without activity records may show an unconfirmed status after disposal; the read-only experiment monitor can additionally use native parent settlement notices.

## Interrupted execution and final reports

The instance configuration panel distinguishes execution status from one-shot final-report availability. A live running Agent takes precedence. A saved terminal event/settlement remains authoritative; otherwise an unfinished turn or activation predating this plugin runtime is shown as interrupted. The reason only establishes an unsettled previous runtime, not a shutdown or crash cause. Missing evidence remains unconfirmed. Reloading the plugin can also create this boundary.

Interrupted instances mark the configuration entry; expand it for recovery guidance. Continue root/continuable work in the original session after checking progress. An interrupted one-shot without an intact report requires its parent to inspect saved evidence and arrange a successor if needed. No automatic model request or bypass of snapshot/parent/permission checks occurs. The native DSH transcript/tree may still use its own completion label; this plugin does not overwrite that private projection.

One-shot reports independently show saved/intact, saved empty result, or no intact readable report. Missing, damaged or wrong-parent results cannot enable export; saved empty results remain exportable but are explicitly labeled. An intact report proves saved delivery, not task acceptance. Drafts and stage checkpoints are not implemented by this change and are never inferred from the latest assistant message.


### DSH 0.2.1-rc.5 lifecycle compatibility

The rc.5 host owns local children through public activations. Foreground one-shot tasks use caller delivery, and their execution scope is released before the result resolves. Read saved configuration with `readInstance` and final text through the report API; do not execute tools or dispatch work using the disposed child. The live Agent reference is valid only during its activation.

The native local descriptor is continuable, while the book record explicitly retains one-shot semantics. Book follow-up and cold resume of a one-shot remain rejected; a successor must be explicitly delegated by its original authorized parent. Background instances retain their original continuable behavior. Cancellation after one-shot acceptance disposes that exact activation. Both versions keep the native manager's ownership, original route, permission snapshot, ancestor ceiling and executable fingerprint; upgrading code is not permission to resume old instances under new code.
