export const BOOK_TITLE = 'A Long Conversation with Myself'
export type PageKind = 'cover' | 'title' | 'imprint' | 'preface' | 'profile' | 'toc' | 'writing' | 'live' | 'margins' | 'colophon'
export type ProcessRecord = { model: string; effort: string }
export type Section = { id: string; title: string; kind?: PageKind; matter?: 'front'; hideFolio?: boolean; process?: ProcessRecord; processExpanded?: boolean; live?: boolean; markdown: string; plainText?: string; role?: 'user' | 'assistant'; recto?: boolean; chapter?: string; source?: boolean }
export type Message = { id: string; role: 'user' | 'assistant'; content: string; process?: ProcessRecord; status?: string; error?: string | null }
export const SOURCE_CARD_HTML = '<aside class="source-card"><a class="source-icon" href="https://example.com" aria-label="打开演示来源">↗</a><div><strong>关于思考与书写的阅读笔记 <small>演示</small></strong><p>模拟来源 · 未访问或抓取任何网页</p></div></aside>'

export function appearsInContents(section: Section) {
  return !['cover', 'title', 'imprint', 'toc', 'margins'].includes(section.kind || '')
}

export const sections: Section[] = [
  { id: 'cover', title: 'Half title', kind: 'cover', matter: 'front', hideFolio: true, markdown: '' },
  { id: 'title', title: 'Title page', kind: 'title', matter: 'front', hideFolio: true, recto: true, markdown: '' },
  { id: 'copyright', title: 'Copyright', kind: 'imprint', matter: 'front', hideFolio: true, markdown: '' },
  { id: 'contents', title: 'Contents', kind: 'toc', matter: 'front', recto: true, markdown: '' },
  { id: 'prologue', title: 'Preface', kind: 'preface', matter: 'front', recto: true, markdown: '' },
  { id: 'profile', title: 'A Note on the Reader', kind: 'profile', matter: 'front', recto: true, markdown: '' },
  { id: 'chapter-one', recto: true, chapter: 'I', title: 'Room for Thought', markdown: `# Room for Thought

Sometimes what we need is a place to put down the things we already know. A message arrives while an article is still open. Halfway through the article we remember an errand, and turn to another window to write it down. A thought can make several such journeys in a morning without ever coming to the end of a sentence.

A book on a desk asks very little of us. We open it where we left off. The words we wrote yesterday occupy the same narrow stretch of paper. There is room for a few more lines underneath them, and for the moment these two pages are all we have to attend to.

## The shape of a question

Try to recall something you have been turning over lately but have not yet put into words. The first attempt may be a description of an afternoon, with a detail repeated twice. It may be a list that trails off halfway down the page. Either will do. A question often takes its shape in the act of writing it.

Write first about the thing that actually happened. Keep the detail that puzzles you, even if it seems too small to account for the time you have spent thinking about it. Leave a little space after it. When you read the passage back, one word may catch your eye. Underline it. The next question can begin with that word.

Once a thought is on paper, it has edges. We can stand a little way off and look at it, or go back to a particular phrase and ask what we meant. Several things that seemed inseparable in the course of the day begin to occupy places of their own.

## An interval

I once wrote out the small interval I wanted to leave between one entry and the next as a piece of code. What interested me was the line in the middle, where for a moment everything waits.

\`\`\`typescript
async function makeRoom(thoughts: Thought[]) {
  for (const thought of thoughts) {
    console.log(thought.question);
    await new Promise(resolve =>
      setTimeout(resolve, 1000));
    thought.settled = true;
  }
  return thoughts;
}
\`\`\`

A piece of code comes to a definite end. A train of thought may leave us with a clearer sense of something we have yet to understand. We can mark the place and take it up again another day.

There is only so much room on a sheet of paper. An exchange can have its limits, too. We need not fit the entire history of a question into its opening sentence or ask each answer to decide the matter for us. We can read to the foot of the page, turn it, and give the next passage the attention it needs.` },
  { id: 'chapter-two', recto: true, chapter: 'II', title: 'A Conversation in Print', markdown: `# A Conversation in Print

It is easy to lose the beginning of a conversation. A remark calls for an answer, the answer brings another question, and by the time we have reached the end we can scarcely remember what made us begin. In a book there are other ways of finding a place again. A turn in the argument lies halfway down a left-hand page. The question that prompted it is still there when we turn back.

## From a question to a page

A question written out in full holds a little of the moment in which it was asked. The choice of a verb, a qualification added at the last minute, even a word that occurs twice may matter when we come to read the answer. I like to keep the question close by, where either voice can be heard in the company of the other.

Sometimes a few lines of an answer are enough. We stop reading to make a note of our own, and when we return the sentence we left unfinished is the one we most want to think about. A brief exchange deserves its place in a book quite as much as one that runs through several pages.

In these pages the questions and replies share the same type. A small heading marks the change of speaker. The margin also belongs to both of them. An idea that began as a hesitant question can turn up later in a reply, stated plainly enough to be recognised at a glance.

## Notes in passing

There are days when it is easier to write straight through. A field note can hold a few words overheard on the way home, the title of something to read, or a sentence that would otherwise be forgotten by morning. It can wait there until its place in the conversation becomes clear.

Looking back through a notebook, I often recognise a page before I recognise the thought recorded on it. I remember how much space was left after the last line and where the pencil caught on the paper. Then I read the words, and the circumstances in which I wrote them begin to return.

A book can stay open at an unfinished exchange. There will be time, on another visit, to read the question again and find out whether the same answer still suggests itself.` },
]

export function conversationSections(messages: Message[], expanded = new Set<string>()): Section[] {
  return messages.flatMap((message, index) => [{
    id: message.id,
    title: `${message.role === 'user' ? '问' : '答'} · ${message.content.replace(/[#*\x60\n]/g, '').slice(0, 18)}${message.content.length > 18 ? '…' : ''}`,
    role: message.role,
    process: message.role === 'assistant' ? message.process : undefined,
    processExpanded: expanded.has(message.id),
    markdown: `${message.role === 'user' ? `###### Question ${Math.floor(index / 2) + 1}` : '###### Reply'}\n\n${message.content}${message.status && message.status !== 'complete' ? `\n\n> 回应未完成（${message.status}）。${message.error || '已保留收到的内容，可继续提问。'}` : ''}`,
  }, ...(message.process && expanded.has(message.id) ? [{
    id: `${message.id}-notes`, title: 'Notes & Sources · 过程附页', source: true,
    markdown: `###### Notes & Sources · 过程记录（示例）\n\n### Reasoning summary\n\n先明确问题，再给出可尝试的小步骤。这是预写的摘要示例，不是模型的隐藏思维链。\n\n### Tool record\n\n\`reference.lookup\` — illustrative only; not executed. 参数：当前问题；示例结果：阅读笔记。没有执行工具或访问网页。\n\nModel: ${message.process.model} · ${message.process.effort}. Local template; no model request.`,
  }] : [])])
}

export function mockReply(question: string, model: string, effort: string) {
  // Quote whole Markdown lines rather than cutting through a link/fence token.
  const quotedQuestion = question.split(/\r?\n/).map(line => `> ${line}`).join('\n')
  return `你写下：\n\n${quotedQuestion}\n\n也许可以先不急着寻找一个完美的答案。把这个问题放在书桌上，我们一起看看：它最让你在意的，究竟是哪一部分？\n\n## 给这个念头一点空间\n\n- **先描述，再判断。** 写下一件实际发生的小事，区分事实与自己的解释。\n- **从一小步开始。** 选择今天就能尝试的一件事，而不是一次解决所有困惑。\n- **允许答案变化。** 此刻的想法只是这一页，不是整本书的结论。\n\n可以试试这样的记录方式：\n\n\x60\x60\x60typescript\nconst reflection = {\n  noticed: '今天值得留意的一件事',\n  question: '我真正想问的是什么？',\n  nextStep: '留出十分钟，写下一段话',\n};\n\nconsole.log(reflection.nextStep);\n\x60\x60\x60\n\n如果愿意，可以接着告诉我一个具体的片段。我们不必把所有事情都讲清楚，只需要从最真实的一句开始。\n\n> 慢一点，问题也会慢慢展开。\n\n这段回应由本地固定模板模拟生成（${model} · ${effort}），并未调用真实模型。你也可以主动打开这份[演示阅读链接](https://example.com)，它不会被自动访问。`
}
