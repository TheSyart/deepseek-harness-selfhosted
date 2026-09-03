# Agent Note:爽文写作模式——一个内置 preset 加一条浏览器一键快捷条

Status: implemented

[English](2026-08-14-shuangwen-writing-mode.md) | 中文

## 问题

Web GUI 为每个会话组装的都是面向编码的 agent preset(`standard`、`code`、`minimal`、`cordis`),因此每个模型请求携带的 persona、工具指引和运行时上下文全是编码 agent 的文本。用这种组装写网络爽文,每轮都在跟系统提示词对抗——模型倾向于确认需求、做计划、反复提问,而不是直接往下写章节。用户要的是「无脑」模式:丢一句话脑洞,然后不断点「下一章」,零输入、零提问、剧情零断线。

## 决策

该模式由两部分组成,各自落在所属的平面上。该自托管快照包含 preset 与插件源码，但默认 Web 组装未安装或挂载 `ui-shuangwen`；快捷条需要部署显式组装，不能仅凭源码存在或构建成功推断其已启用。

### 内置 preset `shuangwen` 拥有模型行为

`apps/cli/config/agent-presets/shuangwen/` 提供一个新的 agent preset,其组装是一行 `persona`(配置 `complete: true` 与 `includeRuntimeContext: false`)加一行 `tool-fs`。persona 即完整系统提示词——部署身份、编码导向、工具指引段落、运行时快照全部不参与——因此写作契约就是全部身份:主角永不吃亏、爽点密集、反派嚣张不过一章、每章结尾留钩子、每章 1500–2500 字,以及无脑工作流(第一条消息就是全部设定,「继续」/「下一章」/ 单独一个标点就是下一章,不反问,人物、境界、伏笔的连续性由模型自己维护)。`tool-fs` 只在读者要求「存稿/导出」时给写手一个保存章节的位置;其余保存能力一律不进会话,也不新增任何主机平面行——主机工具行会并入每一个 agent,无论它由哪个 preset 组装([capability seams](../architecture/2026-06-13-capability-seams.zh.md))。

preset 的显示元数据把它放在花名册 `order: 2`——紧跟标准模式之后——`code`/`minimal`/`cordis` 顺延为 3/4/5,因为写作模式是面向用户的功能,不是藏在末尾的开发者选项。

### 客户端插件 `ui-shuangwen` 拥有一键交互面

`packages/client/ui-shuangwen` 注册一个 `conversation.input.dock` 条目(`id: shuangwen`,`order: -10`),零业务面:所有事实都走框架 hook——会话的 preset id 取自会话列表花名册记录的 `agentPreset`,姿态与忙碌状态取自会话快照,草稿状态取自输入状态机——发送走公开的 `inputActions` 面([slot 系统标准](../architecture/2026-07-22-slot-type-chain-implementation.zh.md))。两种姿态:

- **空白会话**:三个开书脑洞 chip 把完整的开书指令写入草稿但**不提交**——第一条消息定下整本书,因此在用户发送前保持可编辑。
- **已开始的会话**:三个拨盘 chip(下一章 / 加大爽度 / 来个小高潮)写入指令**并提交**,下一章一次点击开始。

会话被移除、回合运行中、输入处于提交中途或草稿非空时,快捷条自我隐藏——绝不覆盖进行中的输入。chip 标签在 `shuangwen` locale 命名空间下双语;写入草稿的消息文本是组件拥有的中文提示词载荷,不属于文案。

## Alternatives considered

- **主机平面工具行或提示词段落**——会把写作身份泄漏进每一个 preset,这正是 preset 平面存在的意义。
- **把快捷条并入 `ui-agent-preset`**——该包拥有的是 preset 管理界面;写作快捷操作是另一个功能(一个 UI 功能一个插件包)。
- **开书 chip 自动提交**——第一条消息定下整本书,必须保持可编辑直到用户按回车;只有续写 chip 才即时发送。

## 后果

- preset 花名册及其选择器 golden 形状改变:`apps/web/tests/snapshots/agent-preset-selection/` 与 `apps/web/tests/snapshots/agent-preset-authoring/` 在同一变更中刷新(菜单、首屏与设置页列表现在在标准模式与 PTC 模式之间包含爽文创作)。
- 浏览器插件表是启动期扫描([client modules](../../../../docs/subsystems/README.zh.md)):`@deepseek-ai/dsh-client-modules` 按包名缓存元数据,因此运行中的 `dsh web` 必须重启才能提供新增的 `dsh.client` 行及其 `lib/client.js`——仅刷新页面无法发现启动后新增的插件。
- 快捷条只服务内置的 `shuangwen` id;以其他 id 本地复制的 preset 得不到快捷条(记录在包 README 的已知限制里)。

## 验证

- `pnpm run test:gui`——包级测试覆盖两种姿态、可见性守卫、语言对等和 apply 接线(声明感知注册与卸载)。
- `DSH_SNAPSHOT=replay pnpm run test:web`——刷新后的 preset golden 与既有花名册 e2e 场景。
- 手动:在爽文创作上新建会话,确认空白会话出现开书 chip,发送一个脑洞,再点「下一章」,确认下一章无需输入即开始流出。
