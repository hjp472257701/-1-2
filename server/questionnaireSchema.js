const LIKERT_5 = [
  { value: 1, label: '1 极不符合我的特征' },
  { value: 2, label: '2 不符合我的特征' },
  { value: 3, label: '3 既符合也不符合我的特征' },
  { value: 4, label: '4 符合我的特征' },
  { value: 5, label: '5 极符合我的特征' },
]

const LIKERT_6 = [
  { value: 1, label: '1 非常不同意' },
  { value: 2, label: '2 不同意' },
  { value: 3, label: '3 有点不同意' },
  { value: 4, label: '4 有点同意' },
  { value: 5, label: '5 同意' },
  { value: 6, label: '6 非常同意' },
]

const LIKERT_7 = [
  { value: 1, label: '1 非常不同意' },
  { value: 2, label: '2 不同意' },
  { value: 3, label: '3 有点不同意' },
  { value: 4, label: '4 中立' },
  { value: 5, label: '5 有点同意' },
  { value: 6, label: '6 同意' },
  { value: 7, label: '7 非常同意' },
]

const AQ_SUBSCALE_MAP = {
  physical: ['AQ01', 'AQ02', 'AQ03', 'AQ04', 'AQ05', 'AQ06', 'AQ07', 'AQ08', 'AQ09'],
  verbal: ['AQ10', 'AQ11', 'AQ12', 'AQ13', 'AQ14'],
  anger: ['AQ15', 'AQ16', 'AQ17', 'AQ18', 'AQ19', 'AQ20', 'AQ21'],
  hostility: ['AQ22', 'AQ23', 'AQ24', 'AQ25', 'AQ26', 'AQ27', 'AQ28', 'AQ29'],
}

const questionnaireSchema = {
  version: 'v5-2026-04-22',
  title: '研究一：问卷调查',
  intro:
    '本页为研究一（问卷），一般会先于研究二的实验任务发放。请根据真实感受作答。问卷约 10-15 分钟，可中途退出但建议一次性完成。',
  demographics: [
    {
      key: 'gender',
      label: '性别',
      type: 'single',
      required: true,
      options: [
        { value: 'male', label: '男' },
        { value: 'female', label: '女' },
        { value: 'other', label: '其他/不便说明' },
      ],
    },
    {
      key: 'age',
      label: '年龄',
      type: 'number',
      required: true,
      min: 16,
      max: 40,
    },
    {
      key: 'grade',
      label: '年级',
      type: 'single',
      required: true,
      options: [
        { value: 'freshman', label: '大一' },
        { value: 'sophomore', label: '大二' },
        { value: 'junior', label: '大三' },
        { value: 'senior', label: '大四' },
        { value: 'master', label: '硕士' },
        { value: 'doctor', label: '博士' },
      ],
    },
    {
      key: 'major',
      label: '专业',
      type: 'text',
      required: true,
      maxLength: 80,
    },
    {
      key: 'income',
      label: '家庭月收入',
      type: 'single',
      required: true,
      options: [
        { value: 'lt3000', label: '3000 元以下' },
        { value: '3000-8000', label: '3000-8000 元' },
        { value: '8001-15000', label: '8001-15000 元' },
        { value: '15001-30000', label: '15001-30000 元' },
        { value: 'gt30000', label: '30000 元以上' },
      ],
    },
    {
      key: 'only_child',
      label: '是否独生子女',
      type: 'single',
      required: true,
      options: [
        { value: 'yes', label: '是' },
        { value: 'no', label: '否' },
      ],
    },
    {
      key: 'student_cadre',
      label: '是否担任学生干部',
      type: 'single',
      required: true,
      options: [
        { value: 'yes', label: '是' },
        { value: 'no', label: '否' },
      ],
    },
    {
      key: 'scholarship',
      label: '是否获得过奖学金',
      type: 'single',
      required: true,
      options: [
        { value: 'yes', label: '是' },
        { value: 'no', label: '否' },
      ],
    },
  ],
  scales: [
    {
      id: 'PRDS',
      title: '特质相对剥夺感量表（PRDS）',
      description: '以下条目采用 6 点计分。请根据你近期的真实感受选择。',
      min: 1,
      max: 6,
      items: [
        {
          id: 'PRDS01',
          text: '当我想起自己拥有的东西与像我一样的其他人相比时，我感到被剥夺了。',
          options: LIKERT_6,
        },
        { id: 'PRDS02', text: '与像我一样的其他人相比，我感到很有特权。', options: LIKERT_6 },
        {
          id: 'PRDS03',
          text: '当我看到像我一样的其他人看起来多么繁荣时，我感到愤恨。',
          options: LIKERT_6,
        },
        {
          id: 'PRDS04',
          text: '当我将自己拥有的与像我一样的其他人相比时，我意识到自己相当富裕。',
          options: LIKERT_6,
        },
        { id: 'PRDS05', text: '与像我一样的其他人相比，我对自己拥有的感到不满意。', options: LIKERT_6 },
      ],
      // 与毕业论文量表 PDF（Callan 等 PRDS 五题）一致：第 2、4 题（特权、自觉富裕）反向计分。
      reverseItems: ['PRDS02', 'PRDS04'],
      scoring: { method: 'sum' },
    },
    {
      id: 'PMD',
      title: '特质道德脱离倾向量表（PMD）',
      description:
        '以下条目采用 7 点计分。题目与出处见 Moore, Detert, Treviño, Baker, & Mayer (2012) 及施测说明 PDF。',
      min: 1,
      max: 7,
      items: [
        { id: 'PMD01', text: '为了保护你在乎的人而散布谣言是可以的。', options: LIKERT_7 },
        { id: 'PMD02', text: '为了帮助家人而撒谎是可以接受的。', options: LIKERT_7 },
        { id: 'PMD03', text: '为了达到重要目标而使用一些强硬手段是必要的。', options: LIKERT_7 },
        {
          id: 'PMD04',
          text: '未经所有者许可拿走东西，只要只是「借用」就没关系。',
          options: LIKERT_7,
        },
        { id: 'PMD05', text: '推搡别人只是开玩笑的一种方式。', options: LIKERT_7 },
        { id: 'PMD06', text: '夸大事实不算是撒谎，只是讲故事的一种方式。', options: LIKERT_7 },
        {
          id: 'PMD07',
          text: '考虑到有些人严重歪曲自己，稍微夸大自己的资历算不上什么罪过。',
          options: LIKERT_7,
        },
        {
          id: 'PMD08',
          text: '当你考虑到其他人正在攻击他人时，损坏财产算不上什么大事。',
          options: LIKERT_7,
        },
        { id: 'PMD09', text: '辱骂别人总比动手打人要好吧。', options: LIKERT_7 },
        {
          id: 'PMD10',
          text: '当人们只是按照权威人物的指示去做有问题的行为时，不应该让他们承担责任。',
          options: LIKERT_7,
        },
        { id: 'PMD11', text: '如果孩子在生活中表现不好，那是因为父母管教太严。', options: LIKERT_7 },
        { id: 'PMD12', text: '学生作弊是因为老师出题太难或不公平。', options: LIKERT_7 },
        { id: 'PMD13', text: '如果朋友们施压，人们行为不端就不能被责怪。', options: LIKERT_7 },
        {
          id: 'PMD14',
          text: '如果小组同意这是处理这种情况的最佳方式，撒谎是可以接受的。',
          options: LIKERT_7,
        },
        { id: 'PMD15', text: '如果整个小组决定排斥某人，那不是任何一个人的错。', options: LIKERT_7 },
        { id: 'PMD16', text: '把不属于自己的想法归功于自己不是什么大不了的事。', options: LIKERT_7 },
        { id: 'PMD17', text: '取笑别人通常不会对他们造成伤害。', options: LIKERT_7 },
        { id: 'PMD18', text: '未经允许拿走一点小东西不会让富人变穷。', options: LIKERT_7 },
        {
          id: 'PMD19',
          text: '有些人必须被粗暴对待，因为他们缺乏可以被伤害的感情。',
          options: LIKERT_7,
        },
        { id: 'PMD20', text: '对待行为像渣滓一样的人不好也没关系。', options: LIKERT_7 },
        { id: 'PMD21', text: '坏人就像害虫一样需要被清除。', options: LIKERT_7 },
        { id: 'PMD22', text: '受到虐待的人通常做了一些事情招致这种待遇。', options: LIKERT_7 },
        {
          id: 'PMD23',
          text: '如果商家犯了有利于你的账单错误，不告诉他们也没关系，因为这是他们的错。',
          options: LIKERT_7,
        },
        { id: 'PMD24', text: '被欺负的人通常活该，因为他们太讨人厌了。', options: LIKERT_7 },
      ],
      reverseItems: [],
      scoring: { method: 'sum' },
    },
    {
      id: 'AQ',
      title: '攻击性问卷（AQ）',
      description: '以下条目采用 5 点计分。',
      min: 1,
      max: 5,
      items: [
        { id: 'AQ01', text: '有人打我的话，我会还击。', options: LIKERT_5 },
        { id: 'AQ02', text: '如果受到足够的挑衅，我可能会打人。', options: LIKERT_5 },
        { id: 'AQ03', text: '我偶尔控制不住想打人的冲动。', options: LIKERT_5 },
        { id: 'AQ04', text: '我打架的次数比一般人多一点。', options: LIKERT_5 },
        { id: 'AQ05', text: '如果不得不使用暴力来保护我的权利，我会这样做。', options: LIKERT_5 },
        { id: 'AQ06', text: '有些人把我逼得太厉害，以至于我们要动手打架。', options: LIKERT_5 },
        { id: 'AQ07', text: '我想不出任何理由去打人。', options: LIKERT_5 },
        { id: 'AQ08', text: '我曾经威胁过我认识的人。', options: LIKERT_5 },
        { id: 'AQ09', text: '我曾气得摔东西。', options: LIKERT_5 },
        { id: 'AQ10', text: '当我和朋友意见不和时，我会公开告诉他们。', options: LIKERT_5 },
        { id: 'AQ11', text: '我经常发现自己和别人意见不一致。', options: LIKERT_5 },
        { id: 'AQ12', text: '当人们惹恼我时，我可能会告诉他们我对他们的看法。', options: LIKERT_5 },
        { id: 'AQ13', text: '当别人不同意我的观点时，我忍不住要争论。', options: LIKERT_5 },
        { id: 'AQ14', text: '我的朋友说我有点爱争辩。', options: LIKERT_5 },
        { id: 'AQ15', text: '我脾气爆发得快，但也去得快。', options: LIKERT_5 },
        { id: 'AQ16', text: '受到挫折时，我会表现出我的不满。', options: LIKERT_5 },
        { id: 'AQ17', text: '我有时候觉得自己像个火药桶，一点就炸。', options: LIKERT_5 },
        { id: 'AQ18', text: '我是一个脾气温和的人。', options: LIKERT_5 },
        { id: 'AQ19', text: '我的一些朋友认为我是一个急脾气的人。', options: LIKERT_5 },
        { id: 'AQ20', text: '有时候我会无缘无故地大发脾气。', options: LIKERT_5 },
        { id: 'AQ21', text: '我很难控制我的脾气。', options: LIKERT_5 },
        { id: 'AQ22', text: '我有时候会被嫉妒冲昏头脑。', options: LIKERT_5 },
        { id: 'AQ23', text: '有时候我觉得生活对我太不公平了。', options: LIKERT_5 },
        { id: 'AQ24', text: '别人似乎总是能得到好运气。', options: LIKERT_5 },
        { id: 'AQ25', text: '我不知道为什么我有时会感到如此痛苦。', options: LIKERT_5 },
        { id: 'AQ26', text: '我知道有“朋友”在背后议论我。', options: LIKERT_5 },
        { id: 'AQ27', text: '我对过于友好的陌生人持怀疑态度。', options: LIKERT_5 },
        { id: 'AQ28', text: '我有时候觉得人们在背后嘲笑我。', options: LIKERT_5 },
        { id: 'AQ29', text: '当人们特别友善时，我想知道他们想要什么。', options: LIKERT_5 },
      ],
      reverseItems: ['AQ07', 'AQ18'],
      scoring: {
        method: 'sum',
        subscales: AQ_SUBSCALE_MAP,
      },
    },
    {
      id: 'ERQ_CR',
      title: '认知重评分量表（ERQ-CR）',
      description: '以下条目采用 7 点计分。',
      min: 1,
      max: 7,
      items: [
        {
          id: 'ERQCR01',
          text: '当我想感受到更多的正向情绪（如快乐或有趣）时，我会改变我在想什么。',
          options: LIKERT_7,
        },
        {
          id: 'ERQCR02',
          text: '当我想感受到更少的负向情绪（如伤心或生气）时，我会改变我在想什么。',
          options: LIKERT_7,
        },
        {
          id: 'ERQCR03',
          text: '当我面临压力情境时，我会通过改变对情境的看法来使自己冷静下来。',
          options: LIKERT_7,
        },
        {
          id: 'ERQCR04',
          text: '当我想感受到更多的正向情绪时，我会改变我看待该情境的方式。',
          options: LIKERT_7,
        },
        {
          id: 'ERQCR05',
          text: '我通过改变我看待所处情境的方式来控制我的情绪。',
          options: LIKERT_7,
        },
        {
          id: 'ERQCR06',
          text: '当我想感受到更少的负向情绪时，我会改变我看待该情境的方式。',
          options: LIKERT_7,
        },
      ],
      reverseItems: [],
      scoring: { method: 'sum' },
    },
    {
      id: 'ATTN',
      title: '体验题组（质量校验）',
      description: '请按题目要求作答。',
      min: 1,
      max: 5,
      items: [
        {
          id: 'ATTN01',
          text: '请认真阅读本题，并选择“4 符合我的特征”。',
          options: LIKERT_5,
        },
        {
          id: 'ATTN02',
          text: '请在本题选择“2 不符合我的特征”。',
          options: LIKERT_5,
        },
        {
          id: 'ATTN03',
          text: '我几乎从不对任何人产生负面情绪。',
          options: LIKERT_5,
        },
        {
          id: 'ATTN04',
          text: '遇到不开心的事，我通常能较快调整情绪。',
          options: LIKERT_5,
        },
        {
          id: 'ATTN05',
          text: '我经常会被小事激怒，且很难平静下来。',
          options: LIKERT_5,
        },
      ],
      reverseItems: [],
      scoring: { method: 'mean' },
    },
  ],
  attentionChecks: [
    { itemId: 'ATTN01', expectedValue: 4, type: 'hard_instruction' },
    { itemId: 'ATTN02', expectedValue: 2, type: 'hard_instruction' },
  ],
  softChecks: {
    socialDesirability: [
      { itemId: 'ATTN03', highThreshold: 4 },
    ],
    contradictoryPairs: [
      { positiveItemId: 'ATTN04', negativeItemId: 'ATTN05', highThreshold: 4 },
    ],
  },
}

function getAllScaleItems() {
  return questionnaireSchema.scales.flatMap((s) =>
    s.items.map((it) => ({ ...it, scaleId: s.id, reverse: s.reverseItems.includes(it.id) }))
  )
}

module.exports = { questionnaireSchema, getAllScaleItems }
