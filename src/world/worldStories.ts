/** Small environmental stories; their visit objectives are resolved by the world save. */
export const STORIES = {
  grass: { hidden:'萤火树洞', secret:'古树的空心里藏着第一位守夜人的信笺，萤火从纸页间升起。', side:'牧风驿站', npc:'迷路的送信人', title:'未送达的家书', reward:'风纹护符', story:'送信人记得营地的灯，却找不到藏信的老树。替他走访余烬营地与萤火树洞。' },
  forest: { hidden:'眠鹿祠', secret:'藤蔓后是一座小小的鹿角祭台。露水落下时，石鹿似乎会睁眼。', side:'林间药庐', npc:'采药女巫', title:'月下的三叶草', reward:'林语药囊', story:'药师需要确认圣所的月光与眠鹿祠的露水是否恢复。替她巡访这两处林中旧地。' },
  desert: { hidden:'倒影地窖', secret:'沙丘的影子比太阳走得更慢，影子尽头的石阶通往一座倒置的藏书室。', side:'流沙商队', npc:'蒙面领路人', title:'遗失的星盘', reward:'寻星罗盘', story:'商队的星盘只剩一半。去沙海遗迹寻找刻度，再到倒影地窖核对失落的星图。' },
  cliff: { hidden:'鹰巢密室', secret:'悬崖侧面垂着一截旧绳。鹰羽包裹的信物仍放在守望者的密室里。', side:'旧索桥工坊', npc:'修桥匠', title:'重响的哨钟', reward:'高地绳索', story:'修桥匠想让断崖哨塔的钟再次响起。先察看哨塔，再寻访藏着钟锤的鹰巢密室。' },
  snow: { hidden:'蓝冰回廊', secret:'冰壁折射出一条并不存在的长廊，尽头封着一朵从未凋谢的雪花。', side:'雪线小屋', npc:'独居的寻路者', title:'消失的足迹', reward:'霜羽披肩', story:'足迹从霜冠神殿延伸进冰壁。替寻路者走过神殿与蓝冰回廊，确认旅人的归途。' },
  ocean: { hidden:'沉星洞窟', secret:'只有潮声轻下来的时候，礁石之间才露出镶满星砂的洞口。', side:'漂木渔舍', npc:'收集瓶信的渔夫', title:'潮汐寄来的信', reward:'潮声海螺', story:'瓶中信提到了沉潮港湾与沉星洞窟。沿着两处潮痕，找回写信人的踪迹。' },
  blood: { hidden:'赤月遗窖', secret:'黑石裂缝里没有血潮的声音，只有一轮微小赤月倒悬在祭杯之中。', side:'渡鸦医所', npc:'戴鸟面具的医者', title:'止息的血潮', reward:'赤月封印', story:'医者怀疑祭坛与赤月遗窖之间仍有旧日的联系。亲自抵达两处，记录潮声的差异。' },
  fog: { hidden:'无名浮岛', secret:'雾里偶尔出现一座不在航图上的浮岛，一盏小灯守着没有名字的墓。', side:'迷雾邮局', npc:'不记得名字的邮差', title:'寄往无名之地', reward:'引雾铃', story:'无名的信封上画着灯塔与一座浮岛。到雾港灯塔辨明方向，再寻访无名浮岛。' },
  swamp: { hidden:'苔心石门', secret:'水草遮住了石门的半张脸，门上的苔纹会随脚步慢慢发亮。', side:'芦苇船坞', npc:'撑船的老蛙人', title:'沼泽里的晚钟', reward:'苔露药瓶', story:'老船夫听见苔泽钟楼与苔心石门交替传来钟声。替他查明这两处声音的来路。' },
  volcano: { hidden:'余火锻室', secret:'熔岩冷却后的窄缝里，仍有一座不用燃料便能发热的锻炉。', side:'熔岩观测站', npc:'火山学徒', title:'尚未熄灭的火种', reward:'余火徽记', story:'学徒想重绘灰烬熔炉的温度图。先去熔炉，再走访余火锻室，确认最后的火种。' },
  crystal: { hidden:'镜心裂隙', secret:'一块透明晶石里有第二片星空，裂隙深处倒映着尚未发生的旅程。', side:'星尘营帐', npc:'记录星光的学者', title:'失落的第十三颗星', reward:'折光晶核', story:'学者的记录在星镜尖塔突然中断。去尖塔与镜心裂隙寻找缺失的那一束光。' },
  waste: { hidden:'白骨地宫', secret:'沙砾掩埋的并非兽骨，而是一条通往旧日地下王国的门楣。', side:'拾荒者集市', npc:'售卖旧地图的老人', title:'风中遗落的名字', reward:'旧王朝铭牌', story:'老人希望找回荒原上失落的名字。察看遗骨王庭，再去白骨地宫确认石碑的残字。' },
} as const;

export const ENCOUNTERS = {
  grass: { name:'风中的路标', text:'一块倒下的路标指着两条路。旧木桩里夹着一枚仍有温度的烬石。', choices:[{label:'扶正路标，收好烬石',outcome:'你修好了路标，得到 3 点烬火。',embers:3,echoes:0},{label:'读完木桩背后的刻字',outcome:'一位旅人的归乡路线被记进手记。',embers:0,echoes:1}] },
  forest: { name:'会说话的树桩', text:'树桩里传来咳嗽声。它想用一段旧故事，换你陪它坐一会儿。', choices:[{label:'听它讲完故事',outcome:'你记住了森林醒来之前的模样。',embers:0,echoes:2},{label:'替它拾来干枝',outcome:'树桩送给你 2 点不灭的烬火。',embers:2,echoes:0}] },
  desert: { name:'沙中铜匣', text:'铜匣上的星纹随着日光缓缓转动。匣内既有火种，也有一幅正在褪色的画。', choices:[{label:'保存画中的记忆',outcome:'沙漠曾经是一座花园。你记录了这段回声。',embers:0,echoes:1},{label:'取出尚存的火种',outcome:'铜匣化作细沙，留下 3 点烬火。',embers:3,echoes:0}] },
  cliff: { name:'悬在风里的铃', text:'一只铜铃挂在断绳尽头。风每吹过一次，就有微弱的火星从铃中落下。', choices:[{label:'接住火星',outcome:'风将 2 点烬火交到你的手里。',embers:2,echoes:0},{label:'轻轻摇响铜铃',outcome:'远处传来旧哨兵的回应，你将它记下。',embers:0,echoes:1}] },
  snow: { name:'雪地里的脚印', text:'一串没有来处的脚印停在雪松下，枝头挂着一盏冻住的旅灯。', choices:[{label:'用 1 点烬火温暖旅灯',outcome:'灯里释放出两段被冰封的回声。',embers:-1,echoes:2},{label:'收集灯底的余火',outcome:'你小心地收好 2 点烬火。',embers:2,echoes:0}] },
  ocean: { name:'漂来的瓶中信', text:'海浪推来一只瓶子。信纸的背面，画着一位旅人再也没见过的故乡。', choices:[{label:'把信抄进手记',outcome:'那片遥远的故乡得以被人记住。',embers:0,echoes:2},{label:'把瓶子送回潮汐',outcome:'海浪送回一块暖石，获得 2 点烬火。',embers:2,echoes:0}] },
  blood: { name:'安静的祭杯', text:'祭杯里没有猩红的水，只有一团在黑暗中蜷缩的火。', choices:[{label:'带走孤独的火种',outcome:'祭杯安静下来，你获得 3 点烬火。',embers:3,echoes:0},{label:'聆听祭杯的回声',outcome:'旧日祭司的名字被写进旅途手记。',embers:0,echoes:1}] },
  fog: { name:'雾中的空船', text:'一艘无人的小船停在灯边。船头放着一张未写完的航图。', choices:[{label:'补完航图',outcome:'你记下了雾中星光的方向。',embers:0,echoes:2},{label:'点亮船头余灯',outcome:'余灯赠你 2 点烬火后驶入雾中。',embers:2,echoes:0}] },
  swamp: { name:'芦苇中的低语', text:'一只小小的苔灵躲在芦苇后，举着一朵会发光的蘑菇。', choices:[{label:'用 1 点烬火交换故事',outcome:'苔灵讲了两个关于沼泽的秘密。',embers:-1,echoes:2},{label:'帮它找到回家的石头',outcome:'苔灵送你 2 点烬火作为谢礼。',embers:2,echoes:0}] },
  volcano: { name:'熔岩上的铁花', text:'一朵铁铸的花在熔流旁开放。每片花瓣都藏着锻造者的记忆。', choices:[{label:'留住花瓣的回声',outcome:'最后一位锻造者的愿望被你记住。',embers:0,echoes:2},{label:'收拢花心的余火',outcome:'铁花缓缓闭合，留下 4 点烬火。',embers:4,echoes:0}] },
  crystal: { name:'倒映明天的晶簇', text:'晶石里的人影比你慢了一拍。它向你递来一束不属于此刻的光。', choices:[{label:'记下那道身影',outcome:'你在手记里留下了一段未来的回声。',embers:0,echoes:2},{label:'接过晶石里的光',outcome:'折射的光聚成 3 点烬火。',embers:3,echoes:0}] },
  waste: { name:'无名者的石碑', text:'风抹平了石碑上的名字，但一位拾荒者始终替它留着一束干花。', choices:[{label:'为它记下今日的风',outcome:'无名的旅人拥有了一段新的记忆。',embers:0,echoes:1},{label:'替它续上灯火',outcome:'碑后的旧灯回应你 2 点烬火。',embers:2,echoes:0}] },
} as const;
