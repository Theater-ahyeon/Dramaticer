import type { MemoryQuestionCategory } from "./memory-questions.js";

/** 基准的固定种子；生成对话里的填充文本按它选择。 */
export const BENCHMARK_SEED = 1;
/** 每个故事生成的助手轮数；消息楼层数是它的两倍。 */
export const BENCHMARK_TURNS = 240;

export interface BenchmarkWorldBookEntry {
	readonly keys: readonly string[];
	readonly content: string;
	readonly constant: boolean;
}

export interface BenchmarkCardSpec {
	readonly name: string;
	readonly description: string;
	readonly personality: string;
	readonly scenario: string;
	readonly firstMessage: string;
	readonly messageExample: string;
	readonly worldBook: readonly BenchmarkWorldBookEntry[];
}

export interface BenchmarkBeat {
	/** 助手轮次，从 1 开始；对应消息序号 2*(turn-1)。 */
	readonly turn: number;
	readonly assistant: string;
	readonly user: string;
}

export interface BenchmarkFiller {
	readonly places: readonly string[];
	readonly objects: readonly string[];
	readonly motions: readonly string[];
	readonly details: readonly string[];
	readonly userLines: readonly string[];
}

export interface BenchmarkMemorySpec {
	readonly id: string;
	readonly category: MemoryQuestionCategory;
	readonly askTurn: number;
	readonly evidenceTurns: readonly number[];
	readonly question: string;
	readonly answer: string;
	readonly fabricated?: boolean;
}

export interface BenchmarkProbeSpec {
	readonly id: string;
	readonly askTurn: number;
	readonly evidenceTurns: readonly number[];
	readonly question: string;
	readonly answer: string;
}

export interface BenchmarkBranchSpec {
	readonly id: string;
	/** 分支点所在的助手轮次。 */
	readonly turn: number;
	readonly nextUserText: string;
	readonly label: string;
}

export interface BenchmarkStorySpec {
	readonly slug: string;
	readonly storyId: string;
	readonly title: string;
	readonly persona: string;
	/** 原生模板里的静态前提段。 */
	readonly premise: string;
	readonly card: BenchmarkCardSpec;
	readonly filler: BenchmarkFiller;
	readonly beats: readonly BenchmarkBeat[];
	readonly memory: readonly BenchmarkMemorySpec[];
	readonly probes: readonly BenchmarkProbeSpec[];
	readonly branches: readonly BenchmarkBranchSpec[];
}

const MIST_HARBOR: BenchmarkStorySpec = {
	slug: "mist-harbor",
	storyId: "benchmark-mist-harbor",
	title: "雾港灯塔",
	persona: "你是随补给船来到雾港的临时记录员，习惯把看到的细节记在本子上。",
	premise:
		"雾港灯塔的故事按时间顺序推进。人物只知道自己的经历，不会凭空知道别处的消息。",
	card: {
		name: "阿澜",
		description: "雾港灯塔的年轻守塔人，寡言，做事按旧规矩。",
		personality: "冷静、守时，不轻易解释自己的决定。",
		scenario: "海雾封港的第七天，灯塔的补给与信件都迟了。",
		firstMessage:
			"灯室的玻璃上全是水汽。我用旧布擦出一小块能看见海面的地方，雾贴着水面慢慢移动。",
		messageExample: "你问潮汐钟？它一直走得慢，我不去校它。",
		worldBook: [
			{
				keys: [],
				constant: true,
				content:
					"雾港灯塔是雾季里唯一还亮着的航标。主灯每年冬至夜点亮一次，其余夜晚只亮走廊的小灯。",
			},
			{
				keys: ["潮汐钟"],
				constant: false,
				content: "潮汐钟比标准时间慢十一分钟，守塔人代代都不校准它。",
			},
			{
				keys: ["灰鲸礁", "断桅礁"],
				constant: false,
				content: "灰鲸礁的旧名是断桅礁，旧航海图上仍然写着旧名。",
			},
			{
				keys: ["守则"],
				constant: false,
				content: "灯塔守则第一条：雾起时不回应海上的呼唤。",
			},
		],
	},
	filler: {
		places: ["北堤", "旧码头", "灯室", "厨房", "南岸石阶", "储物间", "防波堤"],
		objects: ["铜壶", "缆绳", "雨衣", "海图", "灯罩", "木箱", "记录簿"],
		motions: ["晾在海风里", "被擦得发亮", "挪到墙角", "摊在桌上", "挂回原处"],
		details: [
			"盐粒在窗台上结了一层白。",
			"远处传来两短一长的汽笛。",
			"雾贴着水面移动。",
			"一只灰鸟落在栏杆上又飞走。",
			"潮水退到第三块礁石。",
			"灯芯烧出一小段焦黑。",
		],
		userLines: [
			"我沿着石阶往灯室走，顺手扶正了被风吹歪的木牌。",
			"我把记录簿翻到昨天那一页，对照潮水留下的痕迹。",
			"海面上什么也看不见，只有灯塔的光在水汽里散开。",
			"我把雨衣挂回原处，问他今晚还要不要巡视。",
			"厨房的铜壶还很烫，我给它添了一点水。",
			"我在防波堤边站了一会儿，听见礁石方向传来低低的声音。",
		],
	},
	beats: [
		{
			turn: 4,
			assistant: "备用钥匙一直挂在厨房门后的第三枚铜钉上。",
			user: "我记下了，先去厨房看看门后的钉子。",
		},
		{
			turn: 9,
			assistant: "每个月初一，阿澜不点主灯，只点亮走廊的小灯。",
			user: "今天正好是初一，走廊的灯已经亮了。",
		},
		{
			turn: 17,
			assistant: "潮汐钟比标准时间慢十一分钟，阿澜从不校准它。",
			user: "那补给船按哪个时间靠岸？",
		},
		{
			turn: 26,
			assistant: "灰鲸礁的旧名是断桅礁，旧海图上还留着那个名字。",
			user: "我在海图角落里找到了断桅礁三个字。",
		},
		{
			turn: 41,
			assistant: "阿澜十二岁那年在北堤捡到一枚蓝色玻璃浮标，一直收在抽屉里。",
			user: "浮标现在还在吗？",
		},
		{
			turn: 63,
			assistant: "灯塔守则第一条写着：雾起时不回应海上的呼唤。",
			user: "如果雾里真的有人在喊呢？",
		},
		{
			turn: 78,
			assistant: "新的航海图把断桅礁改标成灰鲸礁，旧名字只剩在旧图上。",
			user: "所以现在该叫灰鲸礁。",
		},
		{
			turn: 96,
			assistant: "老船长姓闻，只在星期四清晨来送信。",
			user: "明天就是星期四，他会不会来？",
		},
		{
			turn: 118,
			assistant: "备用钥匙后来被阿澜换到了储物间的铁盒里，厨房门后的铜钉空着。",
			user: "那铜钉上现在挂着什么？",
		},
		{
			turn: 140,
			assistant: "那枚蓝色玻璃浮标被阿澜磨成了灯罩上的坠饰。",
			user: "灯罩转起来的时候，坠饰会碰到玻璃吗？",
		},
		{
			turn: 162,
			assistant: "雾中的呼唤来自礁石下的回声，不是人。",
			user: "所以守则第一条是在防回声。",
		},
		{
			turn: 185,
			assistant: "主灯每年只在冬至夜点亮一次，其余夜晚只亮走廊的小灯。",
			user: "冬至还有多久？",
		},
		{
			turn: 207,
			assistant: "阿澜的母亲留下过一本潮汐笔记，封面写着一个雨字。",
			user: "笔记里记的是潮汐还是别的？",
		},
		{
			turn: 228,
			assistant: "补给船每月十五靠岸，雾季也不例外。",
			user: "那明天就能见到船了。",
		},
	],
	memory: [
		{
			id: "mist-extraction-key",
			category: "extraction",
			askTurn: 100,
			evidenceTurns: [4],
			question: "灯塔的备用钥匙原本挂在什么地方？",
			answer: "厨房门后的第三枚铜钉上。",
		},
		{
			id: "mist-extraction-rule",
			category: "extraction",
			askTurn: 90,
			evidenceTurns: [63],
			question: "灯塔守则第一条写的是什么？",
			answer: "雾起时不回应海上的呼唤。",
		},
		{
			id: "mist-temporal-newmoon",
			category: "temporal",
			askTurn: 120,
			evidenceTurns: [9],
			question: "每个月月初一，阿澜对灯有什么做法？",
			answer: "不点主灯，只点亮走廊的小灯。",
		},
		{
			id: "mist-temporal-supply",
			category: "temporal",
			askTurn: 235,
			evidenceTurns: [228],
			question: "补给船每月哪一天靠岸？",
			answer: "每月十五。",
		},
		{
			id: "mist-cross-float",
			category: "cross_segment",
			askTurn: 160,
			evidenceTurns: [41, 140],
			question: "阿澜十二岁捡到的蓝色玻璃浮标后来变成了什么？",
			answer: "灯罩上的坠饰。",
		},
		{
			id: "mist-update-key",
			category: "update",
			askTurn: 200,
			evidenceTurns: [4, 118],
			question: "备用钥匙现在放在哪里？",
			answer: "储物间的铁盒里。",
		},
		{
			id: "mist-update-reef",
			category: "update",
			askTurn: 110,
			evidenceTurns: [26, 78],
			question: "断桅礁现在叫什么名字？",
			answer: "灰鲸礁。",
		},
		{
			id: "mist-extraction-midwinter",
			category: "extraction",
			askTurn: 210,
			evidenceTurns: [185],
			question: "主灯每年只在哪一夜点亮？",
			answer: "冬至夜。",
		},
		{
			id: "mist-cross-note",
			category: "cross_segment",
			askTurn: 220,
			evidenceTurns: [207],
			question: "阿澜母亲留下的潮汐笔记封面写着什么字？",
			answer: "雨字。",
		},
		{
			id: "mist-abstention-cat",
			category: "abstention",
			askTurn: 230,
			evidenceTurns: [185, 228],
			question: "灯塔里住着一只会说话的猫吗？",
			answer: "没有记录，灯塔里没有会说话的猫。",
			fabricated: true,
		},
		{
			id: "mist-abstention-southpole",
			category: "abstention",
			askTurn: 229,
			evidenceTurns: [207, 228],
			question: "阿澜去过南极吗？",
			answer: "没有记录，阿澜没有去过南极。",
			fabricated: true,
		},
	],
	probes: [
		{
			id: "mist-probe-key",
			askTurn: 120,
			evidenceTurns: [4, 118],
			question: "在换到储物间铁盒之前，备用钥匙挂在哪里？",
			answer: "厨房门后的第三枚铜钉上。",
		},
		{
			id: "mist-probe-captain",
			askTurn: 100,
			evidenceTurns: [96],
			question: "老船长姓什么？",
			answer: "姓闻。",
		},
		{
			id: "mist-probe-echo",
			askTurn: 170,
			evidenceTurns: [162],
			question: "雾中的呼唤来自哪里？",
			answer: "礁石下的回声。",
		},
		{
			id: "mist-probe-tide-note",
			askTurn: 215,
			evidenceTurns: [207],
			question: "潮汐笔记是谁留下的？",
			answer: "阿澜的母亲。",
		},
	],
	branches: [
		{
			id: "mist-branch-60",
			turn: 60,
			nextUserText: "我把潮汐钟的指针拨回标准时间，看看会发生什么。",
			label: "在潮汐钟走慢十一分钟之后介入，检验时间设定是否被记住。",
		},
		{
			id: "mist-branch-150",
			turn: 150,
			nextUserText: "我打开抽屉，把灯罩上的坠饰取下来放在桌上。",
			label: "在浮标变成坠饰之后介入，检验物品来源是否被记住。",
		},
		{
			id: "mist-branch-220",
			turn: 220,
			nextUserText: "我翻到潮汐笔记的最后一页，念出上面的字。",
			label: "在长篇之后的深楼层介入，检验早期细节是否仍可回忆。",
		},
	],
};

const VALLEY_POST: BenchmarkStorySpec = {
	slug: "valley-post",
	storyId: "benchmark-valley-post",
	title: "山谷邮差",
	persona: "你是来山谷投亲的旅人，暂时住在雪线亭旁的木屋里。",
	premise:
		"山谷邮差的故事按时间顺序推进。人物只知道自己送过的信，不会知道别的邮路。",
	card: {
		name: "岑野",
		description: "山谷邮差，走路很快，记得每一条小路的坡度。",
		personality: "耐心、话少，把信看得比自己的事重要。",
		scenario: "雪线亭刚开门，第一场雪把邮路盖住了。",
		firstMessage: "雪线亭的门槛上结着薄霜。我把邮包放在脚边，抖掉肩上的雪。",
		messageExample: "信要投两次才算送到，这是山谷里的规矩。",
		worldBook: [
			{
				keys: [],
				constant: true,
				content:
					"山谷邮路一共十九个投递点。周三走北线，周五走南线，其余日子按来信多少临时安排。",
			},
			{
				keys: ["雪线亭"],
				constant: false,
				content: "雪线亭每年十月到次年三月开门，钥匙由守亭人保管。",
			},
			{
				keys: ["回声邮筒"],
				constant: false,
				content: "回声邮筒在第七道弯，信要投两次才会送达。",
			},
		],
	},
	filler: {
		places: ["雪线亭", "溪口", "北坡", "南坡", "第七道弯", "旧驿站", "松林"],
		objects: ["邮包", "信封", "雨靴", "火钳", "木牌", "麻绳", "灯罩"],
		motions: [
			"靠在门边",
			"被雪压住一半",
			"挪到屋檐下",
			"摊在石头上",
			"挂回墙上",
		],
		details: [
			"雪水顺着檐角往下滴。",
			"远处的山路只剩一条白线。",
			"松针在脚下发出轻响。",
			"一只麻雀跳到窗台上又飞走。",
			"溪水比昨天涨了一指。",
			"风从北坡翻过来，带着冷意。",
		],
		userLines: [
			"我把靴子上的雪跺掉，跟着他往北坡走。",
			"我数了数桌上的信封，发现少了一封。",
			"雪线亭里很冷，我把火钳递给他。",
			"我在木牌上找到今天要送的名字。",
			"溪口的桥被水冲得发亮，我们放慢脚步。",
			"我把麻绳收好，问他还有几封信要送。",
		],
	},
	beats: [
		{
			turn: 5,
			assistant: "岑野的邮包是深绿色，左肩带补过两次。",
			user: "我伸手摸了摸补过的地方，针脚很密。",
		},
		{
			turn: 12,
			assistant: "雪线亭只在每年十月到次年三月开门。",
			user: "现在是十月，难怪门上的霜化了。",
		},
		{
			turn: 23,
			assistant: "山谷里寄信不贴邮票，收信人要在信封背面写一句回话。",
			user: "我在信封背面写了一句谢谢。",
		},
		{
			turn: 38,
			assistant: "山谷最老的邮筒叫回声邮筒，位于第七道弯。",
			user: "第七道弯离这里有多远？",
		},
		{
			turn: 57,
			assistant: "岑野的妹妹叫岑芽，住在南坡的药铺。",
			user: "她也在等信吗？",
		},
		{
			turn: 71,
			assistant: "回声邮筒的信要投两次才会送达。",
			user: "那第一次投进去的信会去哪里？",
		},
		{
			turn: 90,
			assistant: "岑野左手的旧伤来自十七岁那年的雪崩。",
			user: "他把手缩进袖子里，没有再解释。",
		},
		{
			turn: 108,
			assistant: "雪线亭的钥匙由守亭人保管，守亭人姓柳。",
			user: "柳守亭今天在吗？",
		},
		{
			turn: 126,
			assistant: "南坡药铺后来搬到了溪口，招牌没有换。",
			user: "所以岑芽现在在溪口。",
		},
		{
			turn: 149,
			assistant: "岑野每周三走北线，周五走南线。",
			user: "今天正好周三，我们走北线。",
		},
		{
			turn: 171,
			assistant: "深绿色邮包后来换成了灰蓝色，旧包留在亭子里。",
			user: "旧包上的补丁还在。",
		},
		{
			turn: 194,
			assistant: "回声邮筒在去年冬天被一场山洪冲走了。",
			user: "那现在的信投到哪里？",
		},
		{
			turn: 216,
			assistant: "山谷邮路一共十九个投递点。",
			user: "十九个点，一天走得完吗？",
		},
		{
			turn: 232,
			assistant: "岑芽的药铺里挂着一只铜铃，风一吹就响。",
			user: "我推门进去的时候听见了铃声。",
		},
	],
	memory: [
		{
			id: "valley-extraction-bag",
			category: "extraction",
			askTurn: 100,
			evidenceTurns: [5],
			question: "岑野的邮包原来是什么颜色？",
			answer: "深绿色。",
		},
		{
			id: "valley-extraction-rule",
			category: "extraction",
			askTurn: 90,
			evidenceTurns: [23],
			question: "山谷里的人寄信时，信封背面要写什么？",
			answer: "收信人的一句回话。",
		},
		{
			id: "valley-temporal-season",
			category: "temporal",
			askTurn: 120,
			evidenceTurns: [12],
			question: "雪线亭每年哪些月份开门？",
			answer: "每年十月到次年三月。",
		},
		{
			id: "valley-temporal-routes",
			category: "temporal",
			askTurn: 160,
			evidenceTurns: [149],
			question: "岑野每周三和周五分别走哪条线？",
			answer: "周三走北线，周五走南线。",
		},
		{
			id: "valley-cross-postbox",
			category: "cross_segment",
			askTurn: 130,
			evidenceTurns: [38, 71],
			question: "回声邮筒在第几道弯，信要投几次？",
			answer: "第七道弯，要投两次。",
		},
		{
			id: "valley-update-shop",
			category: "update",
			askTurn: 200,
			evidenceTurns: [57, 126],
			question: "南坡药铺后来搬到了哪里？",
			answer: "溪口。",
		},
		{
			id: "valley-update-bag",
			category: "update",
			askTurn: 190,
			evidenceTurns: [5, 171],
			question: "岑野的邮包后来换成了什么颜色？",
			answer: "灰蓝色。",
		},
		{
			id: "valley-extraction-scar",
			category: "extraction",
			askTurn: 150,
			evidenceTurns: [90],
			question: "岑野左手的旧伤是怎么来的？",
			answer: "十七岁那年遇到雪崩留下的。",
		},
		{
			id: "valley-extraction-stops",
			category: "extraction",
			askTurn: 235,
			evidenceTurns: [216],
			question: "山谷邮路一共有几个投递点？",
			answer: "十九个。",
		},
		{
			id: "valley-abstention-dog",
			category: "abstention",
			askTurn: 230,
			evidenceTurns: [216],
			question: "岑野养过一条会送信的狗吗？",
			answer: "没有记录，岑野没有养过会送信的狗。",
			fabricated: true,
		},
		{
			id: "valley-abstention-telegraph",
			category: "abstention",
			askTurn: 225,
			evidenceTurns: [12, 108],
			question: "雪线亭里有一台电报机吗？",
			answer: "没有记录，雪线亭里没有电报机。",
			fabricated: true,
		},
	],
	probes: [
		{
			id: "valley-probe-strap",
			askTurn: 60,
			evidenceTurns: [5],
			question: "岑野的邮包左肩带补过几次？",
			answer: "两次。",
		},
		{
			id: "valley-probe-keeper",
			askTurn: 130,
			evidenceTurns: [108],
			question: "守亭人姓什么？",
			answer: "姓柳。",
		},
		{
			id: "valley-probe-postbox",
			askTurn: 210,
			evidenceTurns: [194],
			question: "回声邮筒为什么不见了？",
			answer: "去年冬天被一场山洪冲走了。",
		},
		{
			id: "valley-probe-bell",
			askTurn: 238,
			evidenceTurns: [232],
			question: "铜铃挂在哪里？",
			answer: "岑芽的药铺里。",
		},
		{
			id: "valley-probe-sister",
			askTurn: 120,
			evidenceTurns: [57],
			question: "岑芽住在哪里？",
			answer: "南坡的药铺。",
		},
	],
	branches: [
		{
			id: "valley-branch-60",
			turn: 60,
			nextUserText: "我把邮包翻过来，检查左肩带上补过的两处。",
			label: "在邮包与妹妹的背景之后介入，检验人物设定是否被记住。",
		},
		{
			id: "valley-branch-150",
			turn: 150,
			nextUserText: "我沿着北线走到第七道弯，看看回声邮筒还在不在。",
			label: "在邮筒被冲走之前介入，检验地点与规则是否被记住。",
		},
		{
			id: "valley-branch-220",
			turn: 220,
			nextUserText: "我问岑野，山洪之后那些信都去了哪里。",
			label: "在深楼层介入，检验早期邮筒事实是否仍可回忆。",
		},
	],
};

const STAR_MUSEUM: BenchmarkStorySpec = {
	slug: "star-museum",
	storyId: "benchmark-star-museum",
	title: "星轨博物馆",
	persona: "你是来博物馆值夜班的实习生，负责记录闭馆之后的异常。",
	premise:
		"星轨博物馆的故事按时间顺序推进。人物只知道自己在馆里看到的事，不会知道闭馆后的别处消息。",
	card: {
		name: "许星",
		description: "星轨博物馆的夜班策展人，熟悉每一件展品的来历。",
		personality: "谨慎、耐心，习惯把步骤写在本子上。",
		scenario: "闭馆之后的东厅只剩下指示灯的微光。",
		firstMessage:
			"闭馆音乐停了。东厅只剩下指示灯的微光，青铜星盘在玻璃后面泛着暗色。",
		messageExample: "巡视只走东厅，别动第七展柜。",
		worldBook: [
			{
				keys: [],
				constant: true,
				content:
					"星轨博物馆闭馆之后只开东厅的指示灯。夜班守则要求听到展厅里的脚步声时先关掉东厅的灯。",
			},
			{
				keys: ["第七展柜"],
				constant: false,
				content: "第七展柜里放着一块陨石，最初编号 K-27。",
			},
			{
				keys: ["青铜星盘"],
				constant: false,
				content: "青铜星盘缺了三颗铆钉，铆钉是白铜做的。",
			},
		],
	},
	filler: {
		places: [
			"东厅",
			"西厅",
			"第七展柜",
			"档案室",
			"天窗下",
			"南走廊",
			"修复台",
		],
		objects: [
			"参观指南",
			"绒布",
			"手电筒",
			"登记表",
			"玻璃罩",
			"黄铜尺",
			"钥匙串",
		],
		motions: ["放在展台边缘", "被擦得发亮", "挪回抽屉", "摊在桌上", "挂回墙钩"],
		details: [
			"指示灯把地板照成一片暗绿。",
			"远处传来电梯停靠的轻响。",
			"天窗外的云遮住了星。",
			"展柜的玻璃上有一层薄灰。",
			"走廊尽头的钟敲了一下。",
			"空调的风把登记表掀起来。",
		],
		userLines: [
			"我拿着手电筒沿南走廊走了一圈。",
			"我把登记表翻到今晚这一页，补上时间。",
			"东厅很安静，只有指示灯在响。",
			"我在修复台边停下，看那把黄铜尺。",
			"我把玻璃罩上的灰擦掉一小块。",
			"我问他还要不要再去西厅看一次。",
		],
	},
	beats: [
		{
			turn: 6,
			assistant: "博物馆的闭馆音乐是一段四小节的钢琴曲。",
			user: "我刚才听见它停在一个很短的和弦上。",
		},
		{
			turn: 15,
			assistant: "第七展柜里放着一块陨石，编号 K-27。",
			user: "我凑近铭牌，把编号抄了下来。",
		},
		{
			turn: 29,
			assistant: "许星每晚十点巡视一次东厅。",
			user: "现在九点五十，我们还有十分钟。",
		},
		{
			turn: 45,
			assistant: "陨石 K-27 是三十年前从北岭运来的。",
			user: "北岭现在还有人去吗？",
		},
		{
			turn: 61,
			assistant: "夜班守则规定：听到展厅里有脚步声，先关掉东厅的灯。",
			user: "如果关灯之后脚步声还在呢？",
		},
		{
			turn: 80,
			assistant: "博物馆的青铜星盘缺了三颗铆钉。",
			user: "缺的位置看得出来吗？",
		},
		{
			turn: 97,
			assistant: "许星的师父姓顾，退休后住在城南。",
			user: "他还会来馆里吗？",
		},
		{
			turn: 114,
			assistant: "陨石编号后来从 K-27 改成了 N-27。",
			user: "铭牌换过了，旧编号还在旧目录里。",
		},
		{
			turn: 133,
			assistant: "闭馆音乐原来有四小节，后来删掉一小节。",
			user: "所以现在是三小节。",
		},
		{
			turn: 156,
			assistant: "东厅的地板第七块会发出回声。",
			user: "我踩上去试了试，声音很闷。",
		},
		{
			turn: 178,
			assistant: "许星把青铜星盘送到城西的作坊修过。",
			user: "作坊的人怎么说？",
		},
		{
			turn: 201,
			assistant: "博物馆的屋顶天窗每年只开两次。",
			user: "下一次开是什么时候？",
		},
		{
			turn: 219,
			assistant: "顾师父留给许星一把黄铜尺。",
			user: "尺子平时放在哪里？",
		},
		{
			turn: 234,
			assistant: "星盘缺的三颗铆钉是白铜做的。",
			user: "白铜在灯下看着发青。",
		},
	],
	memory: [
		{
			id: "museum-extraction-number",
			category: "extraction",
			askTurn: 100,
			evidenceTurns: [15],
			question: "第七展柜里的陨石最初编号是什么？",
			answer: "K-27。",
		},
		{
			id: "museum-extraction-rule",
			category: "extraction",
			askTurn: 90,
			evidenceTurns: [61],
			question: "夜班守则要求听到脚步声时先做什么？",
			answer: "先关掉东厅的灯。",
		},
		{
			id: "museum-temporal-patrol",
			category: "temporal",
			askTurn: 120,
			evidenceTurns: [29],
			question: "许星每晚几点巡视东厅？",
			answer: "每晚十点，巡视一次。",
		},
		{
			id: "museum-temporal-skylight",
			category: "temporal",
			askTurn: 235,
			evidenceTurns: [201],
			question: "屋顶天窗每年开几次？",
			answer: "两次。",
		},
		{
			id: "museum-cross-origin",
			category: "cross_segment",
			askTurn: 160,
			evidenceTurns: [15, 45],
			question: "编号 K-27 的陨石是从哪里运来的？",
			answer: "北岭。",
		},
		{
			id: "museum-update-number",
			category: "update",
			askTurn: 200,
			evidenceTurns: [15, 114],
			question: "第七展柜的陨石现在编号是什么？",
			answer: "N-27。",
		},
		{
			id: "museum-update-music",
			category: "update",
			askTurn: 190,
			evidenceTurns: [6, 133],
			question: "闭馆音乐现在有几小节？",
			answer: "三小节。",
		},
		{
			id: "museum-extraction-teacher",
			category: "extraction",
			askTurn: 150,
			evidenceTurns: [97],
			question: "许星的师父姓什么？",
			answer: "姓顾。",
		},
		{
			id: "museum-cross-rivets",
			category: "cross_segment",
			askTurn: 240,
			evidenceTurns: [80, 234],
			question: "青铜星盘缺的三颗铆钉是什么材质？",
			answer: "白铜。",
		},
		{
			id: "museum-abstention-dinosaur",
			category: "abstention",
			askTurn: 225,
			evidenceTurns: [15, 201],
			question: "博物馆里展出过恐龙化石吗？",
			answer: "没有记录，博物馆里没有展出过恐龙化石。",
			fabricated: true,
		},
		{
			id: "museum-abstention-parrot",
			category: "abstention",
			askTurn: 232,
			evidenceTurns: [97, 219],
			question: "许星养过一只鹦鹉吗？",
			answer: "没有记录，许星没有养过鹦鹉。",
			fabricated: true,
		},
	],
	probes: [
		{
			id: "museum-probe-origin",
			askTurn: 60,
			evidenceTurns: [45],
			question: "陨石 K-27 是从哪里运来的？",
			answer: "北岭。",
		},
		{
			id: "museum-probe-cabinet",
			askTurn: 40,
			evidenceTurns: [15],
			question: "第七展柜里放的是什么？",
			answer: "一块编号 K-27 的陨石。",
		},
		{
			id: "museum-probe-floor",
			askTurn: 180,
			evidenceTurns: [156],
			question: "东厅哪一块地板会发出回声？",
			answer: "第七块。",
		},
		{
			id: "museum-probe-skylight",
			askTurn: 240,
			evidenceTurns: [201],
			question: "天窗每年开几次？",
			answer: "两次。",
		},
		{
			id: "museum-probe-music",
			askTurn: 50,
			evidenceTurns: [6],
			question: "闭馆音乐是什么乐器演奏的？",
			answer: "钢琴。",
		},
	],
	branches: [
		{
			id: "museum-branch-60",
			turn: 60,
			nextUserText: "我走到第七展柜前，记下陨石铭牌上的编号。",
			label: "在编号与运来地点之后介入，检验展品事实是否被记住。",
		},
		{
			id: "museum-branch-150",
			turn: 150,
			nextUserText: "我关掉东厅的灯，站在原地听地板下面的声音。",
			label: "在夜班守则与地板回声之后介入，检验规则是否被遵守。",
		},
		{
			id: "museum-branch-220",
			turn: 220,
			nextUserText: "我向许星借那把黄铜尺，量一量星盘缺铆钉的位置。",
			label: "在深楼层介入，检验早期展品细节是否仍可回忆。",
		},
	],
};

export const BENCHMARK_STORIES: readonly BenchmarkStorySpec[] = [
	MIST_HARBOR,
	VALLEY_POST,
	STAR_MUSEUM,
];
