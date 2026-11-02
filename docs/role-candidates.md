# 首批角色候选书

[角色书 JSON](../examples/role-candidates-v1.json)是可审阅的模板，安装时不自动写入当前书。它按精确模型保存三个角色的Persona与工具声明；工具组件由当前固定映射提供，不再保存插件组合。不是已证明最优的通用Agent。原始生成提示、模型输出、完成状态、用量及文本哈希在 [authorship](../examples/role-candidates-v1.authorship.json)。模型文字逐字保留，没有另写工具教学；历史实战的原组合记录保持不变。

| 角色 | MiMo V2.6 Pro | MiMo V2.6 Flash | 使用范围 |
| --- | --- | --- | --- |
| 研究规划者 | Bash、web_search、web_fetch | 同左 | 独立资料研究、读取需求和源码、给出带证据的施工计划；不是面向用户的全部多轮协作能力 |
| 执行者 | Bash | Bash | 按明确计划修改源码并运行检查 |
| 核对审查者 | 八件套 | Bash | 核对实现/修复及影响面；不能将 Pro 的此候选组合当成所有正确性审查的默认赢家 |

八件套为 Bash、glob、read、grep、edit、write、web_search、web_fetch。原生 `glob/grep` 由独立 `@deepseek-ai/dsh-tool-fs-search` 提供，基线要求显式 `sampleOverCapGlobResults: false`。工具使用偏好是自由选择。当前书只声明工具，教学自动从Promptbook按模型解析；没有本地化命中时保留原生描述。模板没有教学文字，不等同于无教学实验组；历史实战使用当时的原生描述。

选取依据是 MiMo CodeX 的 2026-10-13 角色工具实验：U02 的研究 BW、S01 的施工 B，以及 R03/V01 的 Pro F / Flash B 候选。R01/R02 普通正确性/完备性审查仍以 B 为首选候选。每模型每职责样本有限，新增发现尚有待裁决；这些工程候选不代表永久或跨项目最优性。

Persona 在 2026-10-14 由各目标模型一次性自行撰写，没有进行 Persona/教学消融或候选优选。Token Plan Chat 面的实战使用 Pro 规划、Flash 施工、Pro 核对三个组合；另三个组合仅有原生宿主的离线安装/工具校验。冻结 HTTP 文档验证搜索与抓取接线，不证明公网研究能力。实战完整结果见开发仓的 `log/subagentbook-03/acceptance-report.md`，原始记录由本机 `local-artifacts` 保存。

## 装入自己的书

模板使用 llm-mimo 主路由 `mimo`。若实际使用自定义供应商，把每条 `models[].provider` 改为该 profile 的准确 ID，保留准确模型 ID；不能靠显示名匹配。通过宿主设置服务保存为 `subagentbook.bookJson`，已有书应先合并并处理角色 ID 冲突。该保存会替换整份定义，模板不会自动与既有书合并。

例如，可信开发脚本已注入该 profile 的 `settings` 后：

```js
import fs from 'node:fs/promises';
const candidate = JSON.parse(await fs.readFile(templatePath, 'utf8'));
const provider = 'your-configured-provider-id';
for (const preset of candidate.presets) {
  for (const row of preset.models) row.provider = provider;
}
const current = ctx.settings.describe().find(row => row.ns === 'subagentbook');
await ctx.settings.update('subagentbook', {
  bookJson: JSON.stringify(candidate),
}, current.revision);
```

预算与思考档位省略，采用目标模型当前目录默认值；默认输出预算不是已确认的服务端上限。当前格式/目录改变时仍需通过能力准入。Persona 为直接文字，因此模板不依赖 Promptbook；profile 若启用 Promptbook，仍需 `autoInject: false`。

三个角色都是叶节点（`maxNestedDepth: 0`），根可分别委派，模板没有提供自主调度者或开启任意嵌套。规划/审查需要可信调用者在实际宿主权限上设置只读；执行者需要合适的可写范围。`actionScope` 继承父级，即使有 read/edit/write 或只允许 Bash，工具名单与 Persona 都不能代替文件/网络执行权限。

基线实战的只读 Bash 连 `/tmp` 的临时文件也禁止，因此依赖 `mkdtemp` 的 CLI 测试无法在审查沙箱原样运行。审查者可以做不写盘的探针，完整测试由可信运行者执行并提供结果；有隔离副本时也需授予它明确的实际权限。不要把模型对测试的文字判断当成运行证据。
