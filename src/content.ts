export const BOOK_TITLE = '与自己的漫长对话'
export type PageKind = 'cover' | 'title' | 'imprint' | 'preface' | 'profile' | 'toc' | 'writing' | 'live'
export type ProcessRecord = { model: string; effort: string }
export type Section = { id: string; title: string; kind?: PageKind; matter?: 'front'; hideFolio?: boolean; process?: ProcessRecord; processExpanded?: boolean; live?: boolean; markdown: string; role?: 'user' | 'assistant'; recto?: boolean; source?: boolean }
export type Message = { id: string; role: 'user' | 'assistant'; content: string; process?: ProcessRecord }
export const SOURCE_CARD_HTML = '<aside class="source-card"><a class="source-icon" href="https://example.com" aria-label="打开演示来源">↗</a><div><strong>关于思考与书写的阅读笔记 <small>演示</small></strong><p>模拟来源 · 未访问或抓取任何网页</p></div></aside>'

export const sections: Section[] = [
  { id: 'cover', title: 'Half Title', kind: 'cover', matter: 'front', hideFolio: true, markdown: '' },
  { id: 'title', title: 'Title Page', kind: 'title', matter: 'front', hideFolio: true, recto: true, markdown: '' },
  { id: 'copyright', title: 'Copyright & Imprint', kind: 'imprint', matter: 'front', hideFolio: true, markdown: '' },
  { id: 'contents', title: 'Contents', kind: 'toc', matter: 'front', recto: true, markdown: '' },
  { id: 'prologue', title: 'Preface · Memory', kind: 'preface', matter: 'front', recto: true, markdown: '' },
  { id: 'profile', title: 'About the Reader', kind: 'profile', matter: 'front', recto: true, markdown: '' },
  { id: 'chapter-one', recto: true, title: '第一章 · 给思考留一点空白', markdown: `# 给思考留一点空白\n\n有时候，我们需要的不是更多信息，而是一个能把信息放下来的地方。\n\n屏幕习惯把一切推向我们：新的消息、尚未读完的文章、忽然想起的任务。思绪在这些窗口之间往返，却很少有机会完成一次完整的呼吸。书房是一个小小的反方向：把正在发生的事收进一本书里，一次只看眼前的两页。\n\n## 一个问题的形状\n\n试着问自己：“最近有什么事，我一直在想，却还没来得及写下来？”不必整理成漂亮的句子。一个模糊的念头、一段有些重复的描述，甚至一份没有结尾的清单，都可以成为对话的开头。\n\n- 写下此刻真正关心的问题。\n- 给自己的困惑留出具体的细节。\n- 不急着把每一个空白填满。\n\n当文字落在纸上，问题便有了边界。你可以从远处看它，也可以把其中一个词圈出来，慢慢追问。那些原本挤作一团的事情，开始拥有各自的位置。\n\n## 把慢下来写成一个小程序\n\n下面这段代码不是效率工具，只是一个提醒：为思考保留一点间隔。代码会像正文一样跨页延续，长行会在纸张范围内折行，不会把整本书撑宽。\n\n\x60\x60\x60typescript\n// 不必同时回答所有问题\ntype Thought = { question: string; settled: boolean };\n\nconst notebook: Thought[] = [\n  { question: '今天什么值得记住？', settled: false },\n  { question: '我还想了解什么？', settled: false },\n];\n\nasync function makeRoom(thoughts: Thought[]) {\n  for (const thought of thoughts) {\n    console.log(thought.question);\n    // 留一点时间，而不是立刻跳到下一件事\n    await new Promise(resolve => setTimeout(resolve, 1000));\n    thought.settled = true;\n  }\n  return thoughts;\n}\n\nvoid makeRoom(notebook);\n\x60\x60\x60\n\n代码有明确的结束，但思考未必如此。读完一段回答后，你可能只是更清楚地知道自己还不知道什么。这同样是一种收获。把这一页折进记忆里，下次打开时，再从这里继续。\n\n一张纸的容量是有限的，一次对话也可以是有限的。我们无需把所有背景挤进同一句提问，也不必要求每个回答都替我们做出决定。有限的页面让注意力有所依凭：读完这一段，翻过这一页，再去看接下来会发生什么。这样的节奏不负责消除困惑，却能让困惑变得可以相处。` },
  { id: 'chapter-two', recto: true, source: true, title: '第二章 · 让对话成为一本书', markdown: `# 让对话成为一本书\n\n聊天记录常常越积越长，直到我们忘了最初为什么打开它。一本书则提供另一种线索：章节、页码、空白，以及能再次找到的开头。\n\n## 从提问到书页\n\n在书的续写页写一个问题，按 Enter 发送。回答会先出现在当前书页上，此时它仍在生长，不参与分页。你可以随时停笔；已经写下的部分仍会装订进书里。\n\n1. 写下一个具体的问题。\n2. 看回应在当前书页上慢慢出现。\n3. 墨迹落定，自动装订为新的书页。\n4. 从目录再次找到这轮对话。\n\n每轮提问与回应以小标题区分，正文沿用纸页的书籍字体。它们不是彼此隔开的气泡，而是同一篇文章里的两种声音。\n\n## 也可以，先不成书\n\n切到“速记”，所有对话会成为连续滚动的时间线。草稿不会丢，对话也不会变；当你准备好，再回到书页。\n\n[阅读关于安静思考的示例链接](https://en.wikipedia.org/wiki/Reflection_(philosophy))。链接只在你主动点击时打开，粘贴网址不会触发访问。下方的来源卡只是排版演示，没有抓取网页。\n\n> 一本书并不急于抵达最后一页。\n> 它只是为每一次回来，保留了入口。` },
]

export function conversationSections(messages: Message[], expanded = new Set<string>()): Section[] {
  return messages.flatMap((message, index) => [{
    id: message.id,
    title: `${message.role === 'user' ? '问' : '答'} · ${message.content.replace(/[#*\x60\n]/g, '').slice(0, 18)}${message.content.length > 18 ? '…' : ''}`,
    role: message.role,
    process: message.role === 'assistant' ? message.process : undefined,
    processExpanded: expanded.has(message.id),
    markdown: `${message.role === 'user' ? `###### Conversation ${String(Math.floor(index / 2) + 1).padStart(2, '0')} · 提问` : '###### Response · 回应'}\n\n${message.content}`,
  }, ...(message.process && expanded.has(message.id) ? [{
    id: `${message.id}-notes`, title: 'Notes & Sources · 过程附页', source: true,
    markdown: `###### Notes & Sources · 过程记录（示例）\n\n### Reasoning summary\n\n先明确问题，再给出可尝试的小步骤。这是预写的摘要示例，不是模型的隐藏思维链。\n\n### Tool record\n\n\`reference.lookup\` — illustrative only; not executed. 参数：当前问题；示例结果：阅读笔记。没有执行工具或访问网页。\n\nModel: ${message.process.model} · ${message.process.effort}. Local template; no model request.`,
  }] : [])])
}

export function mockReply(question: string, model: string, effort: string) {
  const excerpt = question.slice(0, 96)
  return `你写下：“${excerpt}”\n\n也许可以先不急着寻找一个完美的答案。把这个问题放在书桌上，我们一起看看：它最让你在意的，究竟是哪一部分？\n\n## 给这个念头一点空间\n\n- **先描述，再判断。** 写下一件实际发生的小事，区分事实与自己的解释。\n- **从一小步开始。** 选择今天就能尝试的一件事，而不是一次解决所有困惑。\n- **允许答案变化。** 此刻的想法只是这一页，不是整本书的结论。\n\n可以试试这样的记录方式：\n\n\x60\x60\x60typescript\nconst reflection = {\n  noticed: '今天值得留意的一件事',\n  question: '我真正想问的是什么？',\n  nextStep: '留出十分钟，写下一段话',\n};\n\nconsole.log(reflection.nextStep);\n\x60\x60\x60\n\n如果愿意，可以接着告诉我一个具体的片段。我们不必把所有事情都讲清楚，只需要从最真实的一句开始。\n\n> 慢一点，问题也会慢慢展开。\n\n这段回应由本地固定模板模拟生成（${model} · ${effort}），并未调用真实模型。你也可以主动打开这份[演示阅读链接](https://example.com)，它不会被自动访问。`
}
