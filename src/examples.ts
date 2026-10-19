export interface Example {
  name: string;
  code: string;
}

export const EXAMPLES: Example[] = [
  {
    name: 'フィードバック制御系（基本）',
    code: `// 標準的なフィードバック制御系
style {
  fontSize: 14
  lineWidth: 1.5
  blockWidth: 110
  blockHeight: 50
}

// --- nodes ---
text r "$r(t)$" at (40, 150)
sum s1 at (120, 150)
block ctrl "Controller\\n$C(s)$" at (250, 150)
block plant "Plant\\n$P(s)$" at (430, 150)
junction j1 at (550, 150)
text y "$y(t)$" at (630, 150)

// --- connections ---
r -> s1 sign "+"
s1 -> ctrl label "$e(t)$"
ctrl -> plant label "$u(t)$"
plant -> j1
j1 -> y
j1 -> s1 sign "-" via (550, 240) (120, 240)
`,
  },
  {
    name: 'PID + 外乱・ノイズ',
    code: `// PID 制御系（外乱 d とセンサノイズ n あり）
style {
  fontSize: 14
  lineWidth: 1.5
  arrow: triangle
  blockFill: #f7f9fc
}

// --- nodes ---
text r "$r$" at (30, 160)
sum s1 at (100, 160)
block pid "PID\\n$K_p + \\frac{K_i}{s} + K_d s$" at (240, 160) size (150, 56)
sum s2 at (380, 160)
text d "$d$" at (380, 70)
block plant "Plant\\n$\\frac{1}{s^2 + 2\\zeta\\omega_n s + \\omega_n^2}$" at (540, 160) size (170, 60)
junction j1 at (680, 160)
text y "$y$" at (750, 160)
sum s3 at (680, 270)
text n "$n$" at (780, 270)
block sensor "Sensor\\n$H(s)$" at (400, 270) fill #fff4e5

// --- connections ---
r -> s1 sign "+"
s1 -> pid label "$e$"
pid -> s2 sign "+" label "$u$"
d -> s2 sign "+"
s2 -> plant
plant -> j1
j1 -> y
j1 -> s3 sign "+"
n -> s3 sign "+"
s3 -> sensor
sensor -> s1 sign "-" via (100, 270)
`,
  },
  {
    name: 'カスケード制御（内側ループ）',
    code: `// カスケード制御系
style {
  fontSize: 13
  lineWidth: 1.4
  blockWidth: 100
  blockHeight: 46
  cornerRadius: 4
}

// --- nodes ---
text r "$r$" at (30, 140)
sum s1 at (90, 140)
block c1 "Outer\\n$C_1(s)$" at (200, 140)
sum s2 at (310, 140)
block c2 "Inner\\n$C_2(s)$" at (420, 140)
block p2 "$P_2(s)$" at (560, 140)
junction j2 at (650, 140)
block p1 "$P_1(s)$" at (760, 140)
junction j1 at (860, 140)
text y "$y$" at (930, 140)
text inner "inner loop" at (480, 260) color #777 fontSize 12
text outer "outer loop" at (480, 330) color #777 fontSize 12

// --- connections ---
r -> s1 sign "+"
s1 -> c1
c1 -> s2 sign "+"
s2 -> c2
c2 -> p2
p2 -> j2
j2 -> p1
p1 -> j1
j1 -> y
j2 -> s2 sign "-" via (650, 230) (310, 230)
j1 -> s1 sign "-" via (860, 300) (90, 300)
`,
  },
  {
    name: 'オブザーバ付き状態フィードバック',
    code: `// オブザーバベースの状態フィードバック
style {
  fontSize: 13
  lineWidth: 1.5
  arrowSize: 9
  blockWidth: 120
  blockHeight: 50
}

// --- nodes ---
text r "$r$" at (30, 120)
sum s1 at (100, 120)
block plant "Plant\\n$\\dot{x} = Ax + Bu$\\n$y = Cx$" at (300, 120) size (150, 70)
junction j1 at (430, 120)
text y "$y$" at (520, 120)
block obs "Observer\\n$\\dot{\\hat{x}} = A\\hat{x} + Bu + L(y - C\\hat{x})$" at (300, 260) size (260, 60) fill #eef6ff
gain k "$-K$" at (100, 260) size (60, 44) flip
junction ju at (180, 120)

// --- connections ---
r -> s1 sign "+"
s1 -> ju
ju -> plant label "$u$"
plant -> j1
j1 -> y
j1 -> obs.right via (430, 260)
ju -> obs.top via (180, 200) (240, 200) dashed
obs -> k label "$\\hat{x}$"
k -> s1 sign "+" via (100, 200)
`,
  },
  {
    name: 'SINDy 残差補償制御（ダークテーマ・グループ枠）',
    code: `// SINDy 残差補償付き制御系 (ダークテーマ)
style {
  font: "Segoe UI, Meiryo, Noto Sans CJK JP, sans-serif"
  fontSize: 15
  lineWidth: 1.6
  lineColor: #9aa0a6
  textColor: #f0f0f0
  blockFill: #1e1e1e
  blockStroke: #5a5a5a
  blockWidth: 205
  blockHeight: 90
  cornerRadius: 10
  background: #141414
  padding: 30
}

// --- 上段: 制御ループ ---
block ref "<b>参考軌跡</b>\\n<small>位置、速度、加速度</small>" at (145, 132) size (215, 92)
block pd "<b>PD 外迴路</b>\\n<small>Kp、Kd 誤差回授</small>" at (395, 132) size (195, 92)
block inertia "<b>慣性解耦</b>\\n<small>名義 M(q)</small>" at (638, 132) size (185, 92) fill #5b4fcf stroke #8f86e8
sum plus "+" at (785, 132) size (34, 34) fill #1e1e1e stroke #777
block robot "<b>驅動器與機器人</b>\\n<small>雙層五連桿</small>" at (955, 132) size (205, 92)

// --- 中段: 補償力矩グループ (点線枠) ---
block grp "" at (637, 340) size (580, 165) fill none stroke #666 dashed radius 10
text grpTitle "補償力矩" at (415, 283) fontSize 14
block nominal "<b>名義動力學補償</b>\\n<small>科氏力、重力</small>" at (502, 355) size (255, 95) fill #5b4fcf stroke #8f86e8
block sindy "<b>SINDy 殘差補償</b>\\n<small>摩擦等未建模項</small>" at (776, 355) size (255, 95) fill #0f5c4a stroke #1fa37f

// --- 下段: オフライン同定 ---
block sparse "<b>稀疏回歸</b>\\n<small>選項與係數估測</small>" at (332, 592) size (255, 95) fill #0f5c4a stroke #1fa37f
block residual "<b>殘差力矩計算</b>\\n<small>量測減名義模型</small>" at (637, 592) size (255, 95) fill #0f5c4a stroke #1fa37f
block records "<b>激發實驗紀錄</b>\\n<small>角度、速度、電流</small>" at (937, 592) size (235, 95)

// --- 凡例 ---
block lg1 "" at (45, 688) size (18, 18) fill #5b4fcf stroke #8f86e8 radius 3
text lg1t "名義模型" at (105, 688) fontSize 14
block lg2 "" at (195, 688) size (18, 18) fill #0f5c4a stroke #1fa37f radius 3
text lg2t "SINDy 資料驅動" at (290, 688) fontSize 14
junction lg3a at (410, 688) hidden
junction lg3b at (465, 688) hidden
text lg3t "離線更新" at (515, 688) fontSize 14

// --- 接続 ---
ref -> pd
pd -> inertia
inertia -> plus
plus -> robot
robot.top -> pd.top via (955, 35) (395, 35)
grp.top -> plus.bottom via (785, 258)
robot.bottom -> sindy.right via (980, 340)
robot.bottom -> records.top via (1030, 400)
records.left -> residual.right
residual.left -> sparse.right
sparse.top -> grp.bottom via (332, 490) (775, 490) dashed label "更新係數"
lg3a -- lg3b dashed
`,
  },
  {
    name: 'Computed torque control + SINDy (English)',
    code: `// Computed torque control (CTC) with SINDy residual compensation
style {
  font: "Arial, Helvetica, sans-serif"
  fontSize: 13
  lineWidth: 1.4
  lineColor: #222222
  textColor: #111111
  blockFill: #ffffff
  blockStroke: #222222
  cornerRadius: 0
  background: #ffffff
  padding: 30
}

// --- online control loop ---
text qd "$q_d,\\ \\dot q_d,\\ \\ddot q_d$" at (60, 130)
sum s1 at (160, 130)
block pd "PD\\n$K_p e + K_d \\dot e$" at (290, 130) size (130, 56)
sum s2 at (400, 130)
text ff "$\\ddot q_d$" at (400, 215)
block inertia "Inertia\\n$\\hat M(q)$" at (510, 130) size (110, 56)
sum s3 at (620, 130)
block robot "Five-bar robot\\n$M(q)\\ddot q + C(q,\\dot q)\\dot q + G(q) = \\tau$" at (790, 130) size (220, 64)
junction j1 at (930, 130)
text qout "$q,\\ \\dot q$" at (1000, 130)
junction j3 at (930, 335)
sum s4 at (620, 230)

// --- torque compensation group ---
block grp "" at (625, 325) size (460, 140) fill none stroke #555 dashed
text grpTitle "Torque compensation" at (585, 268) fontSize 12 color #555
block nominal "Nominal dynamics\\n$\\hat C(q,\\dot q)\\dot q + \\hat G(q)$" at (520, 335) size (190, 60)
block sindy "SINDy residual model\\n$\\hat f(q,\\dot q) = \\Theta(q,\\dot q)\\,\\hat\\Xi$" at (730, 335) size (200, 60)

// --- offline identification group ---
block grp2 "" at (512, 525) size (990, 110) fill none stroke #555 dashed
text grp2Title "Offline identification (SINDy)" at (150, 478) fontSize 12 color #555
block exp "Excitation experiments\\n$\\{q,\\ \\dot q,\\ \\ddot q,\\ \\tau\\}$" at (900, 520) size (190, 60)
block res "Residual torque\\n$\\tau_r = \\tau - \\hat M\\ddot q - \\hat C\\dot q - \\hat G$" at (650, 520) size (230, 60)
block reg "Sparse regression\\n$\\min_\\Xi \\|\\tau_r - \\Theta\\,\\Xi\\|_2^2 + \\lambda\\|\\Xi\\|_1$" at (150, 520) size (240, 60)
block lib "Candidate library\\n$\\Theta(q,\\dot q)$" at (400, 520) size (160, 60)

// --- connections ---
qd -> s1 sign "+"
s1 -> pd label "$e$"
pd -> s2 sign "+"
ff -> s2 sign "+"
s2 -> inertia label "$v$"
inertia -> s3 sign "+"
s3 -> robot label "$\\tau$"
robot -> j1
j1 -> qout
j1.top -> s1.top via (930, 45) (160, 45) sign "-"
j1 -> j3
j3.left -> grp.right label "$q,\\ \\dot q$" offset (-14, -12)
j3 -> exp
nominal.top -> s4.left via (470, 230) sign "+"
sindy.top -> s4.right via (780, 230) sign "+"
s4 -> s3 sign "+" label "$\\tau_c$"
exp.left -> res.right
res.left -> lib.right label "$\\tau_r$"
lib.left -> reg.right
reg.top -> sindy.bottom via (150, 440) (730, 440) dashed label "update $\\hat\\Xi$"
`,
  },
  {
    name: '空のキャンバス',
    code: `// 新しい図
style {
  fontSize: 14
  lineWidth: 1.5
}

// --- nodes ---
block b1 "Block" at (160, 120)

// --- connections ---
`,
  },
];
