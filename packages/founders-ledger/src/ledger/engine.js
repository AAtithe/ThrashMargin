/**
 * The Founder's Ledger: a CEO coaching game, played inside the portal.
 *
 * Plain DOM rather than React: it began as the private claude.ai page in coaching/founders-ledger.html,
 * and this is that page's engine moved into a module. The two are separate copies: a coaching change
 * made here is not made there. React owns the page around it (sign-in gate, loading, saving); this owns
 * everything inside `root`.
 *
 * The host passes the saved state in and gets every change back through `onChange`. The engine never
 * reads storage or the network itself. On the portal `ai` is false: the weekly call is dealt from the
 * built-in bank and the 2030 letter draft is the player's own answers set out as a letter.
 */
const MARKUP = '<div class="wrap">\n  <header>\n    <div class="eyebrow">Williams, Stanley &amp; Co. &middot; CEO coaching</div>\n    <h1>The Founder\'s Ledger</h1>\n    <p class="muted">Points come from what you do, not what you answer. Close your own week every Friday, buy your hours back, and build the life you have written down.</p>\n  </header>\n  <div class="board" id="board"></div>\n  <nav id="tabs" aria-label="Sections"></nav>\n  <main id="view"></main>\n  <div class="status" id="status" aria-live="polite"></div>\n</div>';

export function mountLedger(root, opts = {}) {
  return createLedger(opts.initial, { ...opts, root }).mount();
}

/** The engine without a page, for scripts/drive.ts. Nothing here touches the DOM until mount(). */
export function createLedger(initial, opts = {}) {
const ROOT = opts.root || null;
const AI = !!opts.ai;
const offs = [];
const on = (ev, fn) => { ROOT.addEventListener(ev, fn); offs.push(() => ROOT.removeEventListener(ev, fn)); };
const DAY=86400000, WEEK=7*DAY;
const METERS=[
  {k:'happiness',name:'Happiness',hint:'How much you enjoy the work and the life around it.'},
  {k:'earnings',name:'Earnings',hint:'Your income and the profit behind it, against what you want.'},
  {k:'time',name:'Time back',hint:'10 means you work the hours you choose. 1 means the firm owns your diary.'},
  {k:'focus',name:'Focus',hint:'How much of your week went on work only the CEO can do.'}
];
const PTS={Start:10,Stop:20,Keep:5};

const GAMES=[
 {id:'needed',kind:'default',name:'Being needed',payoff:'You feel valued and in control.',cost:'The firm cannot run without you, so your hours become its ceiling.',move:'Measure yourself by the decisions you no longer have to make.'},
 {id:'fire',kind:'default',name:'Firefighting',payoff:'Adrenaline and visible heroics.',cost:'Fires are what the system produces. While you fight them, nobody fixes the system.',move:'Any fire you put out twice gets a named owner for the cause.'},
 {id:'prove',kind:'default',name:'Proving myself',payoff:'Approval, mostly from people who are not keeping score.',cost:'You take on work to show you can, not because it matters.',move:'Ask whose standard you are trying to meet. If it is not yours, drop it.'},
 {id:'please',kind:'default',name:'Pleasing everyone',payoff:'No conflict today.',cost:'The conflict arrives later with interest, and standards slide in the meantime.',move:'Say the hard thing early and kindly. Clarity is the kind option.'},
 {id:'win',kind:'default',name:'Winning every deal',payoff:'Growth on paper.',cost:'Margin, focus and your team’s goodwill.',move:'Win the right clients at the right price. Lose the rest on purpose.'},
 {id:'control',kind:'default',name:'Control',payoff:'Certainty.',cost:'Good people stop thinking or leave.',move:'Set the standard and the outcome. Let them choose the route.'},
 {id:'build',kind:'chosen',name:'Building a firm that runs without me',payoff:'Freedom and a firm worth more.',cost:'Short-term mess while others learn.',move:'Each week, take one thing out of your own hands for good.'},
 {id:'leaders',kind:'chosen',name:'Growing leaders',payoff:'A bench that multiplies you.',cost:'Patience. They will do it differently and sometimes worse at first.',move:'Coach the judgement. Never supply it when they could.'},
 {id:'life',kind:'chosen',name:'Designing the life I want',payoff:'The firm serves your life, not the reverse.',cost:'Saying no to things that look like opportunities.',move:'Check every new commitment against the 2030 letter.'},
 {id:'long',kind:'chosen',name:'The long game',payoff:'Reputation and margin that compound.',cost:'Fewer quick wins.',move:'Choose what will still be paying off in five years.'}
];

const FOUNDING=[
 {id:'inbox',title:'The inbox',scene:'Monday, 7:40am. 63 unread emails. You are copied on 41 of them.',
  opts:[{t:'Clear it before the team gets in.',v:'trap',n:'You feel productive and have moved nothing. Two of your best hours are gone.'},{t:'Twenty-minute triage. Answer only what needs you. Forward the rest with a named owner.',v:'ok',n:'Sound hygiene. It treats the symptom, not the cause.'},{t:'Block 7:40 to 9:40 for the one thing that matters. Email at 11:30 and 4:00 only.',v:'best',n:'Your sharpest hours go to work only the CEO can do.'}],
  coach:['Being copied on 41 emails is not a communication problem. It is a decision-rights problem. People copy you because they are not sure who decides.','Fix the cause. Write down what needs you and what does not, and send it. The inbox shrinks on its own within a month.'],
  todo:{text:'Publish a one-page decision rights grid: what needs me, what does not, and who decides instead.',type:'Start',h:'week',hours:3}},
 {id:'knock',title:'The 5:30pm knock',scene:'A manager walks in with a client problem. They want you to sort it.',
  opts:[{t:'Take it. You will have it fixed in twenty minutes.',v:'trap',n:'Fast today, slower for ever. You have trained them to bring you the next one.'},{t:'Ask what they recommend. Back their call unless it is dangerous.',v:'best',n:'You coached the judgement instead of supplying it.'},{t:'Put it on the agenda for tomorrow morning.',v:'ok',n:'Delay is not delegation. The client waits and the problem still lands on you.'}],
  coach:['Every problem you solve that your people could have solved buys twenty minutes today and costs a week next quarter.','The rule: no problem without a recommendation. A wrong call owned by a manager is cheaper than a right call that needs you in the room.'],
  todo:{text:'Announce the rule to the team: bring me a problem, bring me your recommendation.',type:'Start',h:'week',hours:2}},
 {id:'client',title:'The client who costs you money',scene:'A top-ten client by hours, bottom-ten by margin, asks for weekly site P&Ls at no extra fee.',
  opts:[{t:'Absorb it. They are a flagship name.',v:'trap',n:'Lower margin on your least profitable client, and you told them it was free.'},{t:'Show them the value of weekly packs and the 3-day close, then reprice the scope.',v:'best',n:'Value made visible, priced properly.'},{t:'Give ninety days notice and exit.',v:'ok',n:'Clean, and sometimes right. Do it after you have tried to reprice, not instead.'}],
  coach:['You would never keep a dish on the menu at a negative margin because it is popular. Run your client list the same way.','Know margin by client, not just fee. Reprice first with the value shown. Those who will not pay for value should work with someone cheaper.'],
  todo:{text:'Run margin by client for the last twelve months. Reprice or exit the bottom quartile.',type:'Start',h:'month',hours:1.5}},
 {id:'cfo',title:'The CFO hat',scene:'Month end, 9:45pm. You are still checking the firm’s own management accounts yourself.',
  opts:[{t:'Keep going. Nobody checks it like you do.',v:'trap',n:'True, and exactly why nobody else has learned to.'},{t:'Promote or hire a finance manager. You review a one-page KPI board on day four.',v:'best',n:'You keep the judgement and give away the execution.'},{t:'Hand it to the team without a brief and hope.',v:'ok',n:'Handing over without a standard is abdication. Write the standard first.'}],
  coach:['CEO and CFO in one person is a ceiling. The CFO role has two halves: judgement and execution.','Keep the judgement: pricing, cash, capital. Give away the execution. Run your own firm on the product you sell: a 3-day close and a KPI board that drives action.'],
  todo:{text:'Write the job spec for the person who takes CFO execution off me. I keep only the judgement.',type:'Start',h:'month',hours:6}},
 {id:'friday',title:'Flat Friday',scene:'Friday, 2:30pm. Your energy has gone and six things are still on the list.',
  opts:[{t:'Push through until 8pm.',v:'trap',n:'Six tasks done badly, two of them redone on Monday.'},{t:'Stop at 3. Walk, train or go home. Do the one task that matters at 7:40 on Monday.',v:'best',n:'You protected the asset the firm depends on most.'},{t:'Spend the afternoon planning next week.',v:'ok',n:'Better than grinding. You are still at your desk when your body is telling you to stop.'}],
  coach:['Hours are a poor measure of a CEO’s output. Energy is a better one.','Happiness is not the reward for finishing the list. It is an input to doing the list well.'],
  todo:{text:'List three activities that give me energy and three that drain it. Remove or delegate one drainer.',type:'Start',h:'week',hours:2}},
 {id:'deal',title:'The shiny 40-site deal',scene:'A 40-site group wants a bespoke service that does not fit your model. The fee is large.',
  opts:[{t:'Say yes. Work out delivery later.',v:'trap',n:'Revenue up, margin and focus down.'},{t:'Say yes on your product, your process and your price.',v:'best',n:'If they want WS, they get WS.'},{t:'Decline politely.',v:'ok',n:'Protects focus. You may have walked away from a client who would have taken the product.'}],
  coach:['Strategy is mostly what you say no to. Bespoke work for a big name feels like growth and often behaves like a tax.'],
  todo:{text:'Write one page: who we serve, what we sell, and what we will not do.',type:'Start',h:'month',hours:1}},
 {id:'meetings',title:'Thirty-one meetings',scene:'Your diary shows 31 meetings this week.',
  opts:[{t:'Attend them all. Visibility matters.',v:'trap',n:'Visible and absent at the same time.'},{t:'Decline anything without an agenda and a decision to make.',v:'ok',n:'A good filter. The recurring ones creep back.'},{t:'Cut to three standing meetings: leadership, numbers, one-to-ones.',v:'best',n:'Your diary now matches your priorities.'}],
  coach:['A CEO’s diary is the strategy in practice. If someone read yours for a month, would they know the firm’s priorities?','Meetings are for decisions and for people, not for passing on information.'],
  todo:{text:'Cancel or delegate every recurring meeting that has not produced a decision in four weeks.',type:'Stop',h:'week',hours:5}},
 {id:'people',title:'The quiet underperformer',scene:'A senior team member has missed the standard for three months. Everyone knows. Nobody says it.',
  opts:[{t:'Give it another quarter.',v:'trap',n:'Your best people are watching what you tolerate.'},{t:'Have the clear conversation this week: gap, standard, thirty days, support.',v:'best',n:'Direct, fair and specific.'},{t:'Quietly take their key work back yourself.',v:'trap',n:'You have added their job to yours and fixed nothing.'}],
  coach:['The standard you walk past is the standard you set. Avoiding the conversation feels kind. It is not.'],
  todo:{text:'Hold the overdue performance conversation: gap, standard, thirty-day plan, support.',type:'Start',h:'week',hours:1}},
 {id:'ideas',title:'Three great ideas',scene:'This week you thought of a client app, a podcast and a new office.',
  opts:[{t:'Start all three.',v:'trap',n:'Three half-built things and a team that cannot tell what matters.'},{t:'Pick the one with the biggest effect on clients. Park the rest in an ideas ledger.',v:'best',n:'One thing gets finished. Nothing is lost.'},{t:'Drop them all.',v:'ok',n:'Disciplined, but founders who stop having ideas stop growing firms.'}],
  coach:['Founders are rarely short of ideas. They are short of finished ones. One major initiative at a time.'],
  todo:{text:'Start an ideas ledger. One major initiative live at a time. Review the ledger monthly.',type:'Start',h:'week',hours:1}},
 {id:'pay',title:'Paying yourself',scene:'Your personal income is whatever is left once everyone else is paid.',
  opts:[{t:'Leave it. The firm comes first.',v:'trap',n:'A firm that cannot pay its founder properly is a demanding job, not yet a good business.'},{t:'Set a target salary and dividend, then back-solve the EBITDA needed to fund it.',v:'best',n:'Your income is now a design target.'},{t:'Pay yourself more now and hope.',v:'ok',n:'Without the link to EBITDA it is a hope, not a plan.'}],
  coach:['You would tell any client the owner’s return is a target, not what is left over. Work backwards from it to the fee base, margin and client mix the firm needs.'],
  todo:{text:'Set my target income for next year and back-solve the EBITDA the firm must deliver to fund it.',type:'Start',h:'month',hours:0}}
];

/* Fallback weekly calls when Claude cannot write one. These carry the mindset themes. */
const BANK=[
 {id:'b-good',title:'The great month',scene:'Record month. Your first thought is what could go wrong next.',
  opts:[{t:'Scan for risks and tighten everything.',v:'trap',n:'The team learns that a record month earns a lecture.'},{t:'Find what caused it, thank the people who did it, and write it down.',v:'best',n:'You have just told the firm what to repeat.'},{t:'Move straight on to next month’s targets.',v:'ok',n:'Ambitious, and nobody will know what worked.'}],
  coach:['Scanning for risk is a strength in an audit and a drain in leadership. What you notice, your team repeats.','Noticing the positives is not soft. It is how you find the cause of good results so you can do it again on purpose.'],
  todo:{text:'Start each Monday meeting with one thing that went right and why it went right.',type:'Start',h:'week',hours:0}},
 {id:'b-space',title:'The empty afternoon',scene:'A meeting cancels. You have two clear hours.',
  opts:[{t:'Fill it with email.',v:'trap',n:'Space appeared and you gave it straight back.'},{t:'Walk with one question about the firm’s next three years.',v:'best',n:'This is the work only you can do.'},{t:'Pick up a client file.',v:'ok',n:'Useful work, done by the most expensive person in the building.'}],
  coach:['Space is where CEO work happens. If your week has none, the firm is being run by its inbox.','Notice space when it appears, and protect it before it appears.'],
  todo:{text:'Protect one two-hour thinking block a week, with one question written down beforehand.',type:'Start',h:'week',hours:2}},
 {id:'b-game',title:'Whose game is this?',scene:'A rival founder posts about doubling headcount. An awards dinner invitation arrives the same day.',
  opts:[{t:'Enter the awards and push for faster growth.',v:'trap',n:'You are now playing their game, scored by their rules.'},{t:'Check both against the game you have chosen, then decide.',v:'best',n:'Your score, your rules.'},{t:'Decline everything external this year.',v:'ok',n:'Safe, but some outside games help yours.'}],
  coach:['Status games are set by other people. They never end and you never win them.','Know the game you are playing and what counts as a point in it. Everything else is noise, however flattering.'],
  todo:{text:'Write down the game I am playing and the score that counts. Read it before accepting any new commitment.',type:'Start',h:'week',hours:1}},
 {id:'b-system',title:'The fire you put out twice',scene:'The same payroll error has hit a third client this quarter. The fix takes you ten minutes.',
  opts:[{t:'Fix it again. It is quicker.',v:'trap',n:'Quicker this time. It will be back.'},{t:'Name an owner for the cause and add a check to the process.',v:'best',n:'You worked on the system, not in it.'},{t:'Tell the team to be more careful.',v:'trap',n:'Most errors come from the system, not from carelessness. The warning changes nothing.'}],
  coach:['Working in the system means doing the work. Working on the system means designing it so the work goes right without you.','Any problem you solve twice is a design fault. Your job is to find the fault, not to keep solving the problem.'],
  todo:{text:'List every problem I solved twice this quarter and give each a named system owner.',type:'Start',h:'month',hours:3}},
 {id:'b-sunday',title:'Sunday evening',scene:'6pm Sunday. You open the laptop to get ahead of the week.',
  opts:[{t:'Two hours now saves stress tomorrow.',v:'trap',n:'It never saves the stress. It moves it into Sunday.'},{t:'Close it. Write tomorrow’s first task on paper.',v:'best',n:'The thought is parked. The evening is yours.'},{t:'Just check email.',v:'trap',n:'One email in, your head is at work until bedtime.'}],
  coach:['The ideal life is not built in big decisions. It is built in the small defaults you repeat every week.','If your ideal week has free Sunday evenings, protect this one. That is how the future gets built.'],
  todo:{text:'Set a Sunday shutdown rule and tell my family what it is.',type:'Stop',h:'week',hours:2}},
 {id:'b-future',title:'The 2030 you',scene:'Picture yourself in 2030 sitting in on this week’s leadership meeting.',
  opts:[{t:'They would say keep pushing.',v:'trap',n:'Unlikely. People who got where they wanted rarely recommend more of what they did before.'},{t:'Ask what they would tell you to stop, write it down, and stop one thing this week.',v:'best',n:'You decided from the future, not from habit.'},{t:'Plan to think about it next quarter.',v:'ok',n:'The future arrives on schedule whether you plan for it or not.'}],
  coach:['Most decisions are made from habit. The best ones are made from the future you have chosen.','Your 2030 letter is a decision filter. Read it, then let it say no on your behalf.'],
  todo:{text:'Read my 2030 letter and stop one thing that version of me would not do.',type:'Stop',h:'week',hours:1}}
];

const WILD=[
 {id:'w4day',title:'The four-day CEO week',what:'Take Fridays off the business for one quarter. Think, train or rest.',todo:'Block every Friday next quarter as a non-operating day and tell the team why.',type:'Start',h:'quarter',hours:8},
 {id:'wfire',title:'Fire one client',what:'The client who costs most in stress and margin. Exit with grace within ninety days.',todo:'Name the one client to exit and send the notice within ninety days.',type:'Stop',h:'month',hours:2},
 {id:'wprice',title:'Ten percent on new work',what:'Every proposal from Monday goes out ten percent higher. Track the win rate.',todo:'Raise all new proposals by ten percent from Monday and track win rate for eight weeks.',type:'Start',h:'week',hours:0},
 {id:'wcos',title:'Hire a chief of staff',what:'Someone whose whole job is your diary, your follow-ups and the things you drop.',todo:'Write the brief for a chief of staff and cost it against my hourly value.',type:'Start',h:'quarter',hours:8},
 {id:'woff',title:'Two weeks fully off',what:'Book it now. Phone off. Whatever breaks becomes your delegation list.',todo:'Book two consecutive weeks off this year and brief the team on who decides what.',type:'Start',h:'quarter',hours:0},
 {id:'whalf',title:'Delete half your recurring meetings',what:'Cancel half for one month. Reinstate only those anybody misses.',todo:'Cancel half my recurring meetings for one month and reinstate only those missed.',type:'Stop',h:'week',hours:4},
 {id:'wmorning',title:'The protected morning',what:'No meetings before 11am, four days a week.',todo:'Block 8 to 11am four days a week for CEO work. No meetings.',type:'Start',h:'week',hours:0},
 {id:'wletter',title:'Write the 2030 letter',what:'A letter dated 2030 describing the firm, your role, your week and your income.',todo:'Write the 2030 letter in the Future section and read it on the first Monday of each month.',type:'Start',h:'month',hours:0},
 {id:'wteach',title:'Bottle your judgement',what:'Record how you read a client’s numbers. Turn it into training so managers think like you.',todo:'Record three walkthroughs of how I read a client pack and turn them into a training module.',type:'Start',h:'quarter',hours:3},
 {id:'wboard',title:'An advisory board of two',what:'Two people who have built bigger firms than yours. Paid, quarterly.',todo:'Shortlist two advisers who have built larger firms and book the first session.',type:'Start',h:'quarter',hours:0},
 {id:'wcfo',title:'A date to stop being CFO',what:'Pick a date after which you do no CFO execution. Tell the team the date.',todo:'Set and announce the date I stop doing CFO execution.',type:'Stop',h:'month',hours:6},
 {id:'wone',title:'One number a day',what:'Pick the one firm metric that best predicts profit and read it daily.',todo:'Choose the one firm metric that best predicts profit and put it on my screen daily.',type:'Keep',h:'week',hours:0}
];
const HOURS_BY_SOURCE={};FOUNDING.concat(BANK).forEach(c=>HOURS_BY_SOURCE[c.id]=c.todo.hours);WILD.forEach(w=>HOURS_BY_SOURCE[w.id]=w.hours);
const HORIZONS={week:'This week',month:'This month',quarter:'This quarter'};
const PILLARS=[['health','Health'],['family','Family and friends'],['wealth','Wealth'],['firm','The firm'],['growth','Growth and learning'],['adventure','Adventure and rest']];
const LETTER_Q=[
 {id:'day',label:'The morning',q:'It is a Tuesday in November 2030. Where are you when the day starts, and what time is it?',hint:'Start concrete. The mind believes detail and ignores slogans.',eg:'At home, 7am, coffee in the garden. No laptop until 9.'},
 {id:'firm',label:'The firm',q:'What does Williams, Stanley & Co look like now?',hint:'Use figures you could check: fee income, EBITDA, clients, team size, what clients say about you.',eg:'120 hospitality clients, £4m fees, 30 percent EBITDA. Known as the firm operators recommend to each other.'},
 {id:'role',label:'Your role',q:'What do you do in the firm now, and what have you stopped doing for good?',hint:'Name the CFO hat. Name the client packs. Say who does them now.',eg:'I chair the leadership team, own pricing and the ten biggest relationships. I have not reviewed a month end since 2027.'},
 {id:'week',label:'A normal week',q:'How many hours do you work, which days, and what fills them?',hint:'This is the week you are designing. Make it the one you actually want, not the one you think you should want.',eg:'Four days, about 35 hours. Mondays are numbers and people. Fridays are mine.'},
 {id:'money',label:'Money',q:'What do you earn, what do you own, and what does it let you do?',hint:'Salary, dividends, property, investments. Then the freedom it buys, which is the point.',eg:'£400k a year from the firm. Mortgage gone. I say yes to things without checking the account.'},
 {id:'people',label:'People',q:'Who runs the firm day to day, and who did you develop to get there?',hint:'Name names if you can. The firm that runs without you is built from people you grew.',eg:'A managing director I promoted in 2027 and a finance director who came up through the client team.'},
 {id:'health',label:'Health and energy',q:'How do you feel physically, and what do you do every week to stay that way?',hint:'Energy is the asset everything else depends on.',eg:'Fitter than at 40. Train four mornings a week. Sleep seven hours.'},
 {id:'family',label:'Family and friends',q:'Who do you spend your best time with, and what do you do together?',hint:'Best time, not leftover time.',eg:'Every school run on Fridays. Dinner with friends once a fortnight without checking my phone.'},
 {id:'adventure',label:'Adventure and rest',q:'What have you done since 2026 that you would never have had time for?',hint:'Trips, projects, learning. The things that would not have happened if you had stayed the bottleneck.',eg:'Six weeks in Japan in 2029. Learned to sail.'},
 {id:'game',label:'The game',q:'What game were you playing that got you here, and what did you have to let go of?',hint:'Which of the default games did you stop playing? Being needed, firefighting, proving yourself?',eg:'I stopped needing to be needed. I let go of being the best accountant in the building.'},
 {id:'thank',label:'The first step',q:'What will 2030 you thank 2026 you for starting this week?',hint:'One action. It goes on your list.',eg:'Writing the finance manager job spec.'}
];
/* Tap-first answers. On a phone every text box is a reason to stop, so each place the game used to ask
   for typing now offers answers from the player's own world, with "Something else" for the rest. */
const PICK={
  hours:['35','40','45','50','55','60','65','70+'],
  oneThing:['Stop reviewing every client pack myself','Hand over the CFO work','Protect my mornings for thinking','Say no to work outside our model','Fix the clients that lose us money','Have the hard people conversations sooner','Take proper time off'],
  protect:['Monday numbers meeting','Time with our key clients','One-to-ones with my managers','Training and exercise','Evenings with family','Nothing yet'],
  good:['Someone solved it without me','A client thanked us','We hit a number','A pack went out on time','A manager made a good call','I left on time','Good energy all day','Time with family'],
  space:['A clear hour to think','A cancelled meeting I kept free','A decision that did not need me','An evening fully off','A calm morning','None this week'],
  inSystem:['Chased people for updates','Fixed an error myself','Checked work line by line','Answered a question that has a written answer','Did a task I had handed over','Sat in a meeting I was not needed in','None this week'],
  change:['No email before 9:30','Protect a two-hour thinking block','Leave by 6 two nights this week','Ask what they recommend before I answer','Cancel one recurring meeting','Hand over one task for good','Take one full day off'],
  decline:['Not now, next quarter','Already doing something like it','Does not fit the life I am building','The firm is not ready for it'],
  score:['Profit per hour of my time','Weeks the firm runs without me','Days fully off a year','Leaders I have developed','Client margin and retention'],
  pillars:{
    health:['Fit, strong and sleeping well','Training four times a week','Energy all day, every day'],
    family:['Every school run on a Friday','Evenings and weekends protected','A long holiday together every year'],
    wealth:['Mortgage gone','A dividend I can rely on','Investments that would let me stop'],
    firm:['Runs without me day to day','The firm operators recommend','Strong margin on every client'],
    growth:['Reading every week','Mentoring other founders','Learning something new each year'],
    adventure:['Six weeks fully off a year','A sabbatical month','A big trip every year'],
  },
};
const LETTER_PICKS={
  day:['At home, 7am. No laptop until 9.','Out on a run before the day starts.','Breakfast with the family, then a slow start.','At a client site, because I chose to be.'],
  firm:['150 hospitality clients, £4m in fees, 30 percent EBITDA.','The firm operators recommend to each other, growing without me chasing it.','Twice the size, with the same margin and a waiting list.','Smaller and more profitable: fewer, better clients.'],
  role:['I chair the leadership team and own pricing. I have not reviewed a month end since 2027.','My time goes on strategy, our top clients and our people. Nothing else.','I coach the firm\'s leaders. Delivery runs without me.','I own the firm and attend one board meeting a month.'],
  week:['Four days, about 35 hours. Fridays are mine.','Three days in the firm, two on my own projects.','Five short days, home by 6 every night.','Six weeks fully off a year, and normal weeks around 40 hours.'],
  money:['£400k a year from the firm. The mortgage has gone.','Enough that I say yes without checking the account.','A set dividend every quarter, whatever happens.','Investments that would let me stop tomorrow.'],
  people:['A managing director I promoted runs it day to day.','A finance director who came up through our client team.','A leadership team of four, each owning a part of the firm.','Managers who make the calls I used to make, and make them well.'],
  health:['Fitter than at 40. I train four mornings a week.','I sleep seven hours and have energy all day.','I walk every day and feel ten years younger.','I have run a marathon since 2026.'],
  family:['Every Friday school run is mine.','Dinner with friends every fortnight, phone in the car.','One long holiday a year with the whole family.','Sunday evenings are family time, laptop closed.'],
  adventure:['Six weeks in Japan.','I learned to sail.','I opened a small restaurant of my own, for the love of it.','A sabbatical month every year.'],
  game:['I stopped needing to be needed.','I let go of being the best accountant in the building.','I stopped firefighting and fixed the system instead.','I stopped saying yes to every deal.'],
  thank:['Writing the finance manager job spec.','Blocking my mornings for thinking.','Repricing the clients that lose us money.','Booking two weeks fully off.'],
};
/* One row of tap targets. `act` makes a tap act at once; otherwise the row is read with picked() on submit. */
function chipRow(group,options,o={}){
  const sel=[].concat(o.selected||[]);
  return `<div class="chips-row" data-group="${group}" data-multi="${o.multi?1:0}" data-max="${o.max||0}">${options.map(v=>`<button type="button" class="pick ${sel.includes(v)?'sel':''}" data-pick-group="${group}" data-val="${esc(v)}"${o.act?` data-pact="${o.act}"`:''}>${esc(v)}</button>`).join('')}${o.other?`<button type="button" class="pick other" data-other="${group}">Something else</button>`:''}</div>${o.other?`<input type="text" class="other-in" id="other-${group}" hidden placeholder="In your own words" aria-label="Something else">`:''}`;
}
function picked(group){
  const vals=[...ROOT.querySelectorAll(`[data-pick-group="${group}"].sel`)].map(b=>b.dataset.val);
  const o=ROOT.querySelector('#other-'+group);
  if(o&&!o.hidden&&o.value.trim())vals.push(o.value.trim());
  return vals;
}
const hoursChip=h=>{const n=Number(h)||0;const opts=PICK.hours.map(x=>parseInt(x,10));let best=opts[0];opts.forEach(x=>{if(Math.abs(x-n)<Math.abs(best-n))best=x;});return best>=70?'70+':String(best);};
const wc=s=>(String(s||'').trim().match(/\S+/g)||[]).length;

const blankFuture=()=>({game:'',gameWords:'',targetHours:45,daysOff:30,income:0,hourly:200,letter:'',pillars:Object.fromEntries(PILLARS.map(([k])=>[k,{now:5,ten:''}]))});
const blank=()=>({v:2,baseline:null,baselineTs:0,todos:[],reviews:[],notes:[],answers:{},calls:[],pendingCall:false,wildMonth:null,wildLog:[],future:blankFuture(),letterQ:{answers:{},step:0},letterDraft:'',letterReads:[],letterCoach:null,practiceRuns:[],deck:{drawn:[],redraws:2},view:'today',callId:null,updatedAt:0});

function migrate(o){
  if(!o)return blank();
  if(o.v===2){const b=blank();const s=Object.assign(b,o);s.future=Object.assign(blankFuture(),o.future||{});s.future.pillars=Object.assign(blankFuture().pillars,(o.future||{}).pillars||{});return s;}
  const s=blank();const now=Date.now();
  if(o.audit&&o.auditDone){s.baseline=Object.assign({},o.audit);s.baselineTs=o.updatedAt||now;}
  s.todos=(o.todos||[]).map(t=>({id:t.id,text:t.text,type:t.type||'Start',h:t.h||'week',hours:t.source&&HOURS_BY_SOURCE[t.source]!=null?HOURS_BY_SOURCE[t.source]:1,done:!!t.done,doneAt:t.done?now:null,star:!!t.star,source:t.source||null,createdAt:now}));
  s.reviews=(o.reviews||[]).map(r=>Object.assign({ts:now,good:[],space:'',game:'',inSystem:'',win:'',change:''},r));
  s.answers=Object.assign({},o.answers||{});
  ((o.wild&&o.wild.kept)||[]).forEach(id=>s.wildLog.push({month:'earlier',id,decision:'accepted',reason:''}));
  s.updatedAt=o.updatedAt||0;
  return s;
}
let S=migrate(initial||null);

const $=s=>ROOT.querySelector(s);
const byId=id=>ROOT.querySelector('#'+id);
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>Math.random().toString(36).slice(2,10);
const gbp=n=>'£'+Math.round(n).toLocaleString('en-GB');
const fmtDate=ts=>new Date(ts).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
const weekNo=ts=>Math.floor((ts/DAY+3)/7);
const monthKey=ts=>{const d=new Date(ts);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');};
const allCalls=()=>FOUNDING.concat(S.calls);
const findCall=id=>allCalls().find(c=>c.id===id)||BANK.find(c=>c.id===id);

/* ---------- Derived numbers. Nothing here is stored, so nothing can drift. ---------- */
function streakAt(i){let n=1;for(let j=i;j>0;j--){if(S.reviews[j].ts-S.reviews[j-1].ts<=10*DAY)n++;else break;}return n;}
function streak(){if(!S.reviews.length)return 0;const last=S.reviews[S.reviews.length-1];if(Date.now()-last.ts>10*DAY)return 0;return streakAt(S.reviews.length-1);}
function points(){
  let p=0;
  S.todos.forEach(t=>{if(t.done){p+=PTS[t.type]||10;if(t.source&&t.source.startsWith('w'))p+=20;}});
  S.reviews.forEach((r,i)=>{p+=15+Math.min(5*(streakAt(i)-1),25);});
  const perWeek={};S.notes.forEach(n=>{const w=weekNo(n.ts);perWeek[w]=(perWeek[w]||0)+1;});
  Object.values(perWeek).forEach(c=>p+=3*Math.min(c,3));
  if(wc(S.future.letter)>=150)p+=30;
  p+=10*new Set((S.letterReads||[]).map(monthKey)).size;
  return p;
}
function boughtBack(){
  const now=Date.now();let total=0,perWeek=0;
  S.todos.forEach(t=>{if(t.done&&t.doneAt&&t.hours>0){perWeek+=t.hours;total+=t.hours*Math.max(0,(now-t.doneAt)/WEEK);}});
  return {total,perWeek,value:total*(Number(S.future.hourly)||0)};
}
function latest(){return S.reviews.length?S.reviews[S.reviews.length-1]:S.baseline;}
function ceoIndex(){const l=latest();if(!l)return null;return Math.round(METERS.reduce((a,m)=>a+Number(l[m.k]||0),0)/4*10);}
function reviewDue(){if(!S.reviews.length)return true;return Date.now()-S.reviews[S.reviews.length-1].ts>=6*DAY;}
function doneBy(pred){return S.todos.filter(t=>t.done&&pred(t)).length;}
function lastN(n){return S.reviews.slice(-n);}
function levels(){
  const st=streak(),done=doneBy(()=>true),stops=doneBy(t=>t.type==='Stop');
  const target=Number(S.future.targetHours)||45;
  const l4=lastN(4);
  const hrsOk=l4.length===4&&l4.every(r=>Number(r.hours)<=target);
  const cfo=doneBy(t=>t.source==='cfo'||t.source==='wcfo')>0;
  const off=doneBy(t=>t.source==='woff')>0;
  const focus=l4.length===4&&l4.every(r=>Number(r.focus)>=8);
  const st12=st>=12;
  const L=[
    {name:'Operator',checks:[]},
    {name:'Leader',checks:[['Four Friday reviews in a row',st>=4,`${Math.min(st,4)}/4`],['Five actions done',done>=5,`${Math.min(done,5)}/5`],['Two Stop actions done',stops>=2,`${Math.min(stops,2)}/2`]]},
    {name:'Architect',checks:[['Hours at or under your target ('+target+') for four reviews running',hrsOk,`${l4.filter(r=>Number(r.hours)<=target).length}/4`],['Fifteen actions done',done>=15,`${Math.min(done,15)}/15`],['CFO execution handed over',cfo,cfo?'done':'open']]},
    {name:'Owner',checks:[['Twelve Friday reviews in a row',st12,`${Math.min(st,12)}/12`],['Two weeks fully off taken',off,off?'done':'open'],['Focus at 8 or above for four reviews running',focus,`${l4.filter(r=>Number(r.focus)>=8).length}/4`]]}
  ];
  let cur=0;for(let i=1;i<L.length;i++){if(L[i].checks.every(c=>c[1]))cur=i;else break;}
  return {L,cur,next:L[cur+1]||null};
}

/* ---------- Scoreboard ---------- */
function renderBoard(){
  const lv=levels(),st=streak(),bb=boughtBack();const due=reviewDue();
  $('#board').innerHTML=`
   <div class="tile lvl"><span class="lab">Level</span><span class="fig">${lv.L[lv.cur].name}</span><span class="sub">${lv.next?'Next: '+lv.next.name+', '+lv.next.checks.filter(c=>c[1]).length+' of '+lv.next.checks.length+' met':'Top of the ladder'}</span></div>
   <div class="tile ${st===0&&S.reviews.length?'warn':''}"><span class="lab">Friday streak</span><span class="fig">${st} wk${st===1?'':'s'}</span><span class="sub">${due?(S.reviews.length?'Review due now':'Start it this Friday'):'Next review from '+fmtDate(S.reviews[S.reviews.length-1].ts+6*DAY)}</span></div>
   <div class="tile"><span class="lab">Hours bought back</span><span class="fig">${bb.perWeek.toFixed(1)}<span style="font-size:15px;font-weight:500"> hrs/wk</span></span><span class="sub">Worth ${gbp(bb.perWeek*46*(Number(S.future.hourly)||0))} a year at ${gbp(S.future.hourly||0)}/hr &middot; ${bb.total.toFixed(1)} hrs banked so far</span></div>
   <div class="tile"><span class="lab">Ledger points</span><span class="fig">${points()}</span><span class="sub">Earned by doing, never by answering</span></div>`;
}
function renderTabs(){
  const open=S.todos.filter(t=>!t.done).length;
  const unplayed=S.calls.filter(c=>S.answers[c.id]==null).length+(S.pendingCall?1:0)+FOUNDING.filter(c=>S.answers[c.id]==null).length;
  const tabs=[['today','Today',''],['review','Friday review',reviewDue()?'due':''],['actions','Actions',open?String(open):''],['calls','Play',unplayed?String(unplayed):''],['future','Future','']];
  $('#tabs').innerHTML=tabs.map(([k,l,n])=>`<button data-tab="${k}" aria-current="${S.view===k}">${l}${n==='due'?'<span class="due" aria-label="due"></span>':n?`<span class="n">${n}</span>`:''}</button>`).join('');
}

function addTodo(t){
  if(t.source){const ex=S.todos.find(x=>x.source===t.source);if(ex){ex.text=t.text;ex.type=t.type;ex.h=t.h;return ex;}}
  const n=Object.assign({id:uid(),done:false,doneAt:null,star:false,source:null,hours:0,createdAt:Date.now()},t);S.todos.push(n);return n;
}

/* ---------- Today ---------- */
function vToday(){
  if(!S.baseline)return vBaseline();
  const lv=levels();const stars=S.todos.filter(t=>t.star&&!t.done);
  const l=latest();const b=S.baseline;
  const call=S.calls.find(c=>S.answers[c.id]==null);
  const chosen=GAMES.find(g=>g.id===S.future.game);
  const played=S.reviews.filter(r=>r.game);const onGame=chosen?played.filter(r=>r.game===chosen.id).length:0;
  const lastGame=played.length?GAMES.find(g=>g.id===played[played.length-1].game):null;
  return `<section>
  ${reviewDue()?`<div class="card call-to"><div class="spread"><div><div class="eyebrow">Friday review ${S.reviews.length?'due':'not started'}</div><h2>Close your own week. Ten minutes.</h2></div><button class="btn" data-tab="review">Start the review</button></div><p class="muted">The review is the game. It keeps the streak alive, earns ${15+Math.min(5*streak(),25)} points, and unlocks next week’s call.</p></div>`:''}
  ${S.pendingCall||call?`<div class="card"><div class="spread"><div><div class="eyebrow">This week’s call</div><h3>${call?esc(call.title):'Your review unlocked a new call'}</h3></div>${call?`<button class="btn small" data-opencall="${call.id}">Play it</button>`:`<button class="btn small" data-act="dealCall">Deal this week’s call</button>`}</div>${call?`<p class="muted">${esc(call.scene)}</p>`:`<p class="muted">${AI?'Written from what you logged this week.':'Dealt from the coaching bank after your review.'} It adds one action to your list.</p>`}</div>`:''}
  <div class="big3"><div class="eyebrow">This week’s big three</div>${stars.length?`<ol>${stars.map(t=>`<li>${esc(t.text)}</li>`).join('')}</ol>`:'<p class="muted">Star up to three actions in Actions. Three is the most a CEO moves properly in one week.</p>'}</div>
  <div class="card"><div class="eyebrow">Notice</div><h3>What went well? Where was there space?</h3>
   <p class="muted small">One tap the moment you see it. Three a week score points.</p>
   <div class="lbl small">Went well</div>${chipRow('n-good',PICK.good,{act:'note-good'})}
   <div class="lbl small">Space</div>${chipRow('n-space',PICK.space.filter(x=>x!=='None this week'),{act:'note-space'})}
   <details class="own"><summary>Something else</summary><form class="row" id="noticeForm" style="flex-wrap:nowrap"><input type="text" id="noticeText" placeholder="In your own words" aria-label="What you noticed"><button class="btn small" type="submit" data-kind="good">Good</button><button class="btn small ghost" type="submit" data-kind="space">Space</button></form></details>
   <div class="notes">${S.notes.slice(-5).reverse().map(n=>`<div class="note"><span class="kd ${n.kind}">${n.kind==='good'?'Good':'Space'}</span><span>${esc(n.text)} <span class="muted small">${fmtDate(n.ts)}</span></span></div>`).join('')||'<div class="empty">Nothing logged yet this week.</div>'}</div></div>
  <div class="grid2">
   <div class="card"><div class="eyebrow">The game you are playing</div>
    ${chosen?`<h3>You chose: ${esc(chosen.name)}</h3>`:'<h3>You have not chosen your game yet</h3>'}
    ${lastGame?`<p class="small">Last week the game that ran you was <span class="${lastGame.kind==='chosen'?'delta-up':'delta-down'}">${esc(lastGame.name)}</span>.</p><p class="small muted">${esc(lastGame.move)}</p>`:'<p class="small muted">Each Friday you name the game that actually ran your week. The gap between that and the one you chose is the coaching.</p>'}
    ${chosen&&played.length?`<p class="small">On your chosen game ${onGame} of ${played.length} weeks.</p>`:''}
    ${chosen?'':'<div><button class="btn small ghost" data-tab="future">Choose it in Future</button></div>'}
   </div>
   <div class="card"><div class="eyebrow">Next level: ${lv.next?lv.next.name:'complete'}</div>
    <div class="ladder">${lv.L.map((x,i)=>`<span class="rung ${i<=lv.cur?'on':''}">${x.name}</span>`).join('')}</div>
    ${lv.next?`<ul class="checks">${lv.next.checks.map(c=>`<li class="${c[1]?'ok':''}"><span class="mk">${c[1]?'[x]':'[ ]'}</span><span>${c[0]}</span><span class="prog">${c[2]}</span></li>`).join('')}</ul><p class="small muted">Levels follow behaviour. Break the streak and the level can drop.</p>`:'<p>The firm runs without you and you have the life you wrote down. Keep the streak.</p>'}
   </div>
  </div>
  ${vLetterNudge()}
  ${vWildMonth()}
  <div class="card"><div class="spread"><h3>Your four lines</h3><span class="small muted">${S.reviews.length?'Latest review against your opening position':'Opening position'}</span></div>
   ${METERS.map(m=>{const v=Number(l[m.k])*10,d=(Number(l[m.k])-Number(b[m.k]))*10;return `<div class="meter"><span class="name">${m.name}</span><div class="bar"><i style="width:${v}%"></i></div><span class="val">${v}${d?` <span class="${d>0?'delta-up':'delta-down'}">${d>0?'+':''}${d}</span>`:''}</span></div>`;}).join('')}
   <p class="small muted">CEO index ${ceoIndex()}. These move only when you re-score yourself on a Friday.</p></div>
  </section>`;
}
function vLetterNudge(){
  const words=wc(S.future.letter);const ans=S.letterQ.answers||{};const n=LETTER_Q.filter(x=>(ans[x.id]||'').trim()).length;
  if(words<150)return `<div class="card"><div class="spread"><div><div class="eyebrow">The 2030 letter</div><h3>${n?`${n} of ${LETTER_Q.length} questions answered`:'Write the life you are building'}</h3></div><button class="btn small" data-goto="letter">${n?'Carry on writing':'Start with question one'}</button></div><p class="small muted">Eleven questions, one at a time. ${AI?'Claude turns your answers into a first draft in your voice.':'Your answers become a first draft you rewrite in your own words.'} A finished letter scores 30 points.</p></div>`;
  const read=(S.letterReads||[]).some(t=>monthKey(t)===monthKey(Date.now()));
  if(!read)return `<div class="card"><div class="spread"><div><div class="eyebrow">The 2030 letter</div><h3>Read it this month</h3></div><button class="btn small ghost" data-goto="letter">Open the letter</button></div><p class="small muted">Read it once a month, then decide one thing this week that 2030 you would want. 10 points a month.</p></div>`;
  return '';
}
function letterChecks(t){
  const words=wc(t),nums=(t.match(/£?\d[\d,.]*/g)||[]).length,fut=(t.match(/\b(will|want to|hope|would like|going to)\b/gi)||[]).length;
  const P={Health:/health|fit|train|gym|run|sleep|energy|walk/i,'Family and friends':/family|wife|husband|partner|children|kids|son|daughter|friends/i,Wealth:/£|income|dividend|wealth|invest|property|mortgage|earn/i,'The firm':/firm|client|team|WS\b|Williams/i,'Growth and learning':/learn|read|study|course|grow|teach/i,'Adventure and rest':/holiday|travel|trip|adventure|rest|sail|week off|weeks off/i};
  const missing=Object.keys(P).filter(k=>!P[k].test(t));
  return [
    {ok:words>=250&&words<=700,label:'Length',note:`${words} words. Aim for 250 to 600: enough detail to feel real, short enough to read every month.`},
    {ok:nums>=4,label:'Specific figures',note:nums>=4?`${nums} figures. Good. Numbers turn a wish into something you can measure against.`:`Only ${nums} figures. Add hours, income, team size, days off. You would not accept a budget without numbers.`},
    {ok:fut<=2,label:'Written as done',note:fut<=2?'Written as if it has already happened.':`"Will", "want to" or "hope" appear ${fut} times. Rewrite those lines as fact: it has happened.`},
    {ok:!missing.length,label:'Whole life',note:missing.length?`Not covered yet: ${missing.join(', ')}. A life plan that is all firm is a business plan.`:'Every pillar of your life is in it.'},
    {ok:/\b(stopped|no longer|handed|gave up|let go|do not|don't|have not|haven't|never|not since)\b/i.test(t),label:'What you stopped',note:/\b(stopped|no longer|handed|gave up|let go|do not|don't|have not|haven't|never|not since)\b/i.test(t)?'It says what you no longer do. That is where the time came from.':'Nothing says what you stopped doing. The future is built from what you give up as much as what you add.'}
  ];
}
function vLetter(){
  const f=S.future,q=S.letterQ,ans=q.answers||{};const n=LETTER_Q.filter(x=>(ans[x.id]||'').trim()).length;
  const step=Math.min(q.step||0,LETTER_Q.length-1),cur=LETTER_Q[step],words=wc(f.letter);
  const read=(S.letterReads||[]).some(t=>monthKey(t)===monthKey(Date.now()));
  const c=S.letterCoach;
  return `<div class="card" id="letter"><div class="spread"><div><div class="eyebrow">The 2030 letter</div><h3>Write it with a coach, one question at a time</h3></div><span class="small muted">${n}/${LETTER_Q.length} answered &middot; ${words} words written</span></div>
   <p class="small muted">Tap the line closest to the life you want, or write your own. ${AI?'When you have three or more, Claude drafts the letter in your voice and you edit it until it sounds like you.':'When you have three or more, your answers are set out as a first draft and you rewrite it until it sounds like you.'}</p>
   <div class="bar"><i style="width:${Math.round(n/LETTER_Q.length*100)}%"></i></div>
   <div class="dots">${LETTER_Q.map((x,i)=>`<button class="dot ${(ans[x.id]||'').trim()?'done':''} ${i===step?'cur':''}" data-lqstep="${i}" aria-label="${esc(x.label)}">${i+1}</button>`).join('')}</div>
   <div class="lq"><div class="eyebrow">${step+1} of ${LETTER_Q.length} &middot; ${esc(cur.label)}</div><div class="scene" style="font-size:20px">${esc(cur.q)}</div>
    ${chipRow('lq-'+cur.id,LETTER_PICKS[cur.id]||[],{act:'lq',selected:ans[cur.id]||''})}
    <details class="own" ${ans[cur.id]&&!(LETTER_PICKS[cur.id]||[]).includes(ans[cur.id])?'open':''}><summary>Write my own line</summary><textarea id="lq-${cur.id}" data-lq="${cur.id}" aria-label="${esc(cur.label)}" placeholder="In your own words">${esc(ans[cur.id]||'')}</textarea></details>
    <div class="row"><button class="btn small ghost" data-act="lqPrev" ${step?'':'disabled'}>Back</button><button class="btn small" data-act="lqNext">${step<LETTER_Q.length-1?'Next question':'Finish the questions'}</button></div></div>
   <div class="row"><button class="btn" data-act="draftLetter" ${n>=3?'':'disabled'}>Draft my letter from these answers</button><span class="small muted">${n>=3?'Your answers, your numbers, your pillars and your chosen game go into the draft.':'Answer at least three questions first.'}</span></div>
   ${S.letterDraft?`<div class="coach"><div class="eyebrow">First draft${S.letterDraftBy==='claude'?' by Claude':''}</div><div style="white-space:pre-wrap;max-width:66ch">${esc(S.letterDraft)}</div><div class="row"><button class="btn small" data-act="useDraft">${f.letter.trim()?'Replace my letter with this draft':'Use this draft'}</button><button class="btn small ghost" data-act="discardDraft">Discard</button></div></div>`:''}
   <div class="field"><label for="f-letter">Your letter</label><span class="hint">Edit until every line sounds like you. It saves as you type.</span><textarea class="letter" id="f-letter" data-future="letter" placeholder="Dear Tom, it is November 2030...">${esc(f.letter)}</textarea></div>
   <div class="row"><button class="btn small" data-act="coachLetter" ${words>=40?'':'disabled'}>Coach my letter</button><button class="btn small ghost" data-act="readLetter" ${words>=40&&!read?'':'disabled'}>${read?'Read this month':'I have read it this month'}</button></div>
   ${c?`<div class="coach"><div class="eyebrow">Coaching on your letter &middot; ${fmtDate(c.ts)}</div>
     <ul class="checks">${c.checks.map(x=>`<li class="${x.ok?'ok':''}"><span class="mk">${x.ok?'[x]':'[ ]'}</span><span><span style="font-weight:600">${esc(x.label)}.</span> ${esc(x.note)}</span><span></span></li>`).join('')}</ul>
     ${c.ai?`${c.ai.strengths&&c.ai.strengths.length?`<p><span style="font-weight:600">What is working.</span> ${c.ai.strengths.map(esc).join(' ')}</p>`:''}
      ${(c.ai.sharpen||[]).map(s=>`<p><span class="muted">"${esc(s.quote)}"</span><br>${esc(s.question)}</p>`).join('')}
      ${c.ai.missing&&c.ai.missing.length?`<p><span style="font-weight:600">Missing.</span> ${c.ai.missing.map(esc).join(' ')}</p>`:''}
      ${c.ai.firstAction?`<div class="added">The first step this letter asks for: ${esc(c.ai.firstAction)} <button class="btn small ghost" data-act="addFirst" style="margin-left:6px">Add to actions</button></div>`:''}`
     :`<p class="small muted">${c.aiTried?'Claude could not read the letter just now, so these are the standard checks only.':''}</p>`}
   </div>`:''}
  </div>`;
}
function vWildMonth(){
  const mk=monthKey(Date.now());const wm=S.wildMonth&&S.wildMonth.month===mk?S.wildMonth:null;
  if(!wm)return `<div class="card"><div class="spread"><div><div class="eyebrow">Wildcard of the month</div><h3>One bold move, dealt once a month</h3></div><button class="btn small ghost" data-act="dealWild">Deal this month’s wildcard</button></div><p class="small muted">You take it on or you decline it with a reason. Either way it is a decision, not drift. Done wildcards score 20 extra points.</p></div>`;
  const w=WILD.find(x=>x.id===wm.id);
  return `<div class="wcard"><span class="tag">Wildcard of the month &middot; ${HORIZONS[w.h]}</span><h3>${esc(w.title)}</h3><p>${esc(w.what)}</p>
   ${wm.decision?`<p class="small ${wm.decision==='accepted'?'delta-up':'muted'}">${wm.decision==='accepted'?'Taken on. It is in Actions.':'Declined'+(wm.reason?': '+esc(wm.reason):'.')}</p>`:
   `<div class="row"><button class="btn small" data-act="wildAccept">Take it on</button></div><div class="lbl small">Or decline it, because:</div>${chipRow('decline',PICK.decline,{act:'decline'})}`}</div>`;
}
function vBaseline(){
  const a={happiness:5,earnings:5,time:5,focus:5,hours:55,protect:'',oneThing:''};
  return `<section><div class="card"><div><div class="eyebrow">Opening position</div><h2>Score yourself honestly. Nobody else sees this.</h2></div>
   <p class="muted">Rate each line out of ten as it is today. This is the line every Friday review is measured against.</p>
   <div class="grid2">${METERS.map(m=>`<div class="field"><label for="b-${m.k}">${m.name}</label><span class="hint">${m.hint}</span><div class="rate-line"><input type="range" id="b-${m.k}" min="1" max="10" value="${a[m.k]}" data-out="ob-${m.k}"><output id="ob-${m.k}">${a[m.k]}</output></div></div>`).join('')}</div>
   <div class="field"><span class="lbl">Hours worked last week</span>${chipRow('b-hours',PICK.hours,{selected:'55'})}</div>
   <div class="field"><span class="lbl">The one change that would make the biggest difference</span>${chipRow('b-one',PICK.oneThing,{other:true})}</div>
   <div class="field"><span class="lbl">What is working that you must protect?</span>${chipRow('b-protect',PICK.protect,{other:true})}</div>
   <div class="row"><button class="btn" data-act="saveBaseline">Lock the opening position</button></div></div></section>`;
}

/* ---------- Friday review ---------- */
function vReview(){
  const l=latest()||{happiness:5,earnings:5,time:5,focus:5,hours:50};
  const open=S.todos.filter(t=>!t.done&&(t.h==='week'||t.star));
  const sameWeek=S.reviews.length&&Date.now()-S.reviews[S.reviews.length-1].ts<4*DAY;
  return `<section>
  <div class="card"><div><div class="eyebrow">Friday review &middot; ten minutes</div><h2>Close your own week in three days or less.</h2></div>
   <p class="muted">${sameWeek?'You logged a review on '+fmtDate(S.reviews[S.reviews.length-1].ts)+'. Logging again replaces it.':'All taps, no typing. Same five steps every week.'}</p></div>

  <div class="card"><div class="eyebrow">1. What you did</div><h3>Tick what got done</h3>
   ${open.length?open.map(t=>`<label class="item" style="cursor:pointer"><input type="checkbox" data-done="${t.id}"><span class="txt"><span>${esc(t.text)}</span><span class="meta"><span class="pill ${t.type}">${t.type}</span><span class="pill">+${PTS[t.type]} pts</span>${t.hours?`<span class="pill">${t.hours} hrs/wk back</span>`:''}</span></span><span></span></label>`).join(''):'<p class="empty">Nothing open for this week. Add actions in Actions.</p>'}
   <div class="field"><span class="lbl">Hours worked this week</span><span class="hint">Your target is ${S.future.targetHours} (set in Future).</span>${chipRow('rv-hours',PICK.hours,{selected:hoursChip(l.hours)})}</div></div>

  <div class="card"><div class="eyebrow">2. Re-score</div><h3>Where are the four lines now?</h3>
   <div class="grid2">${METERS.map(m=>`<div class="field"><label for="rv-${m.k}">${m.name}</label><div class="rate-line"><input type="range" id="rv-${m.k}" min="1" max="10" value="${l[m.k]}" data-out="ov-${m.k}"><output id="ov-${m.k}">${l[m.k]}</output></div></div>`).join('')}</div></div>

  <div class="card"><div class="eyebrow">3. Notice</div><h3>Three good things, and where there was space</h3>
   <p class="small muted">Tap up to three. Each good thing has a cause: find it and you can repeat it.</p>
   ${chipRow('rv-good',PICK.good,{multi:true,max:3,other:true})}
   <div class="field"><span class="lbl">Where did you notice space?</span>${chipRow('rv-space',PICK.space,{other:true})}</div></div>

  <div class="card"><div class="eyebrow">4. The game</div><h3>Which game actually ran your week?</h3>
   <p class="small muted">Be honest. Red are the default games most founders play without noticing. Green are the ones worth choosing.</p>
   <div class="games">${GAMES.map(g=>`<button class="game" data-game="${g.id}" type="button"><span class="gk ${g.kind}">${g.kind==='default'?'Default game':'Chosen game'}</span><span class="gn">${esc(g.name)}</span><span class="gd">Pays: ${esc(g.payoff)}</span></button>`).join('')}</div>
   <div id="gameNote"></div>
   <div class="field"><span class="lbl">Where did you work in the system instead of on it?</span><span class="hint">It goes on your list as a job to design out.</span>${chipRow('rv-system',PICK.inSystem,{other:true})}</div></div>

  <div class="card"><div class="eyebrow">5. Next week</div>
   <div class="field"><span class="lbl">The one thing you will do differently</span><span class="hint">It goes on your list, to check next Friday.</span>${chipRow('rv-change',PICK.change,{other:true})}</div>
   <div class="row"><button class="btn" data-act="review">Log the week</button></div></div>

  ${S.reviews.length?`<div class="card"><h3>The trend</h3><div class="tbl-wrap"><table><thead><tr><th>Week</th>${METERS.map(m=>`<th class="num">${m.name}</th>`).join('')}<th class="num">Hours</th><th>Game</th><th>Win</th></tr></thead><tbody>
   ${[Object.assign({date:'Opening',game:''},S.baseline)].concat(S.reviews.map(r=>Object.assign({date:fmtDate(r.ts)},r))).map((r,i,arr)=>`<tr><td>${esc(r.date)}</td>${METERS.map(m=>{const d=i?r[m.k]-arr[i-1][m.k]:0;return `<td class="num">${r[m.k]}${d?` <span class="${d>0?'delta-up':'delta-down'}">${d>0?'+':''}${d}</span>`:''}</td>`;}).join('')}<td class="num ${i&&Number(r.hours)<=Number(S.future.targetHours)?'delta-up':''}">${r.hours}</td><td>${esc((GAMES.find(g=>g.id===r.game)||{}).name||'')}</td><td class="wrapc">${esc(r.win||r.note||'')}</td></tr>`).join('')}
   </tbody></table></div></div>`:''}
  </section>`;
}

/* ---------- Actions ---------- */
function vActions(){
  const done=S.todos.filter(t=>t.done).length;const bb=boughtBack();
  const order={Stop:0,Start:1,Keep:2};
  const groups=Object.keys(HORIZONS).map(h=>{
    const items=S.todos.filter(t=>t.h===h).sort((a,b)=>(a.done-b.done)||(order[a.type]-order[b.type]));
    return `<div class="todo-group"><div class="spread"><h3>${HORIZONS[h]}</h3><span class="small muted">${items.filter(t=>t.done).length}/${items.length} done</span></div>${items.length?items.map(item).join(''):'<div class="empty">Nothing here yet.</div>'}</div>`;
  }).join('');
  return `<section>
   <div class="card"><div class="spread"><div><div class="eyebrow">Actions</div><h2>${S.todos.length?`${done} of ${S.todos.length} done`:'Your actions'}</h2></div><button class="btn ghost small" data-act="copy" ${S.todos.length?'':'disabled'}>Copy as text</button></div>
   <p class="small muted">Stop scores ${PTS.Stop}, Start ${PTS.Start}, Keep ${PTS.Keep}. Wildcards add 20. Put an honest estimate on the hours each one gives back a week: once ticked, those hours count up every week on your scoreboard. You are buying back ${bb.perWeek.toFixed(1)} hours a week so far.</p>
   ${S.todos.length?'':'<p class="empty">Play a call, take on a wildcard or add your own below.</p>'}
   ${groups}
   <details class="own"><summary>Add your own action</summary><form class="add-row" id="addForm"><input type="text" id="addText" placeholder="Add your own action" aria-label="New action"><select id="addType" aria-label="Type"><option>Start</option><option>Stop</option><option>Keep</option></select><select id="addH" aria-label="When">${Object.entries(HORIZONS).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select><input type="number" id="addHrs" min="0" max="40" step="0.5" value="0" aria-label="Hours back per week"><button class="btn small" type="submit">Add</button></form></details></div>
   <div class="card"><h3>How to work the list</h3><p class="muted">Stops come first because removing a drain frees the time for every start. Anything still open after three Fridays is either not important or owned by the wrong person. Decide which, then delete or delegate it. Deleting an action you no longer believe in is a good decision, not a failure.</p></div>
  </section>`;
}
function item(t){
  const src=t.source?(t.source.startsWith('w')?'Wildcard':t.source.startsWith('audit')?'Opening':t.source.startsWith('review')?'Review':'Call'):'';
  return `<div class="item ${t.done?'done':''}"><input type="checkbox" ${t.done?'checked':''} data-done="${t.id}" aria-label="Done"><div class="txt"><span>${esc(t.text)}</span><div class="meta"><span class="pill ${t.type}">${t.type}</span>${src?`<span class="pill">${src}</span>`:''}<span class="hrs"><input type="number" min="0" max="40" step="0.5" value="${t.hours||0}" data-hrs="${t.id}" aria-label="Hours back per week"> hrs/wk back</span>${t.done&&t.doneAt?`<span class="small muted">done ${fmtDate(t.doneAt)}</span>`:''}</div></div><div class="acts">${t.done?'':`<button class="icon-btn ${t.star?'on':''}" data-star="${t.id}">${t.star?'Starred':'Star'}</button>`}<button class="icon-btn" data-del="${t.id}">Del</button></div></div>`;
}

/* ---------- Play: practice round, wildcard deck, weekly calls ---------- */
/* Practice meters are a game inside the game. They never touch ledger points or the real four lines. */
const DELTAS={inbox:[[-3,0,-6,-6],[1,1,3,3],[3,3,5,8]],knock:[[-1,0,-5,-4],[3,2,6,5],[0,-1,-2,-1]],client:[[-2,-6,-4,-2],[1,8,1,2],[2,-2,4,3]],cfo:[[-4,0,-7,-3],[4,2,7,6],[1,-2,3,-1]],friday:[[-5,-1,-6,-4],[6,1,5,3],[2,1,1,3]],deal:[[-3,3,-6,-7],[2,6,1,4],[1,-2,2,4]],meetings:[[-4,-1,-8,-6],[3,1,6,5],[4,2,8,7]],people:[[-3,-3,-3,-3],[2,3,3,4],[-3,0,-6,-4]],ideas:[[2,-2,-7,-9],[2,3,2,7],[-2,-1,1,2]],pay:[[-3,-4,0,-1],[4,8,0,4],[2,2,0,-2]]};
const VD={best:[3,3,4,5],ok:[1,0,1,1],trap:[-3,-2,-4,-4]};
const deltaFor=(c,i)=>(DELTAS[c.id]&&DELTAS[c.id][i])||VD[c.opts[i].v]||[0,0,0,0];
const pLabel=i=>i>=75?'Architect':i>=60?'Leader':i>=40?'Operator':'Running on effort';
function practice(){
  const base=METERS.map(m=>S.baseline?Number(S.baseline[m.k])*10:50);const plus=[0,0,0,0];
  const answered=FOUNDING.filter(c=>S.answers[c.id]!=null);
  answered.forEach(c=>deltaFor(c,S.answers[c.id]).forEach((x,i)=>plus[i]+=x));
  const vals=base.map((b,i)=>Math.max(0,Math.min(100,b+plus[i])));
  const best=answered.filter(c=>c.opts[S.answers[c.id]].v==='best');
  const traps=answered.filter(c=>c.opts[S.answers[c.id]].v==='trap');
  const ok=answered.length-best.length-traps.length;
  return {base,plus,vals,index:Math.round(vals.reduce((a,v)=>a+v,0)/4),answered,best,traps,judgement:best.length*10+ok*5};
}
function pattern(t,b,n){
  if(n<FOUNDING.length)return 'Finish all ten calls for a full read.';
  if(t>=4)return 'You default to doing it yourself. That instinct built the firm and it is now the main limit on it. The work for the next ninety days is to move from being the best operator in the building to building operators.';
  if(t>=1)return 'You know the right answer most of the time. The traps you took are where habit beats judgement under pressure. Those are the habits to rebuild first, because pressure is when they show up.';
  if(b>=8)return 'Your judgement is sound. The gap is not knowing what to do, it is doing it every week. The Friday review is where that gets tested.';
  return 'Sensible, but you often stop at workable. Workable keeps the firm running. World-class calls are what free your time and lift the margin.';
}
function vPracticePanel(pr){
  const runs=S.practiceRuns||[];const bestRun=runs.length?Math.max(...runs.map(r=>r.judgement)):null;
  return `<div class="card"><div class="spread"><div><div class="eyebrow">Practice round &middot; the founding ten</div><h3>Practice P&amp;L ${pr.index} &middot; ${pLabel(pr.index)}</h3></div><span class="small muted">Judgement ${pr.judgement}/100${bestRun!=null?` &middot; best ${bestRun}`:''} &middot; ${pr.answered.length}/10 played</span></div>
   ${METERS.map((m,i)=>`<div class="meter"><span class="name">${m.name}</span><div class="bar"><i style="width:${pr.vals[i]}%"></i></div><span class="val">${pr.vals[i]}${pr.plus[i]?` <span class="${pr.plus[i]>0?'delta-up':'delta-down'}">${pr.plus[i]>0?'+':''}${pr.plus[i]}</span>`:''}</span></div>`).join('')}
   <p class="small muted">Practice meters start from your opening position and move with each choice. They never change your ledger points or your real four lines. Only doing the actions does that.</p></div>`;
}
function vResults(pr){
  const runs=S.practiceRuns||[];const prev=runs.length?runs[runs.length-1]:null;
  const low=METERS.map((m,i)=>({n:m.name,v:pr.vals[i]})).sort((a,b)=>a.v-b.v)[0];
  return `<div class="card"><div class="eyebrow">Results</div><h2>Practice P&amp;L ${pr.index}: ${pLabel(pr.index)}</h2>
   <p>${pr.best.length} of ${pr.answered.length} world-class calls. Judgement score ${pr.judgement} out of 100${prev?`, against ${prev.judgement} last time`:''}. ${pr.traps.length?`You took the trap on: ${pr.traps.map(t=>t.title).join(', ')}.`:'You avoided every trap.'}</p>
   <div class="coach"><div class="eyebrow">What the pattern says</div><p>${pattern(pr.traps.length,pr.best.length,pr.answered.length)}</p><p>Your weakest practice line is ${low.n.toLowerCase()} at ${low.v}. Draw from the wildcard deck below and keep at least one card that would lift it.</p></div>
   ${runs.length?`<div class="tbl-wrap"><table><thead><tr><th>Run</th><th class="num">Judgement</th><th class="num">World-class</th><th class="num">Traps</th><th class="num">P&amp;L</th></tr></thead><tbody>${runs.map((r,i)=>`<tr><td>${i+1} &middot; ${fmtDate(r.ts)}</td><td class="num">${r.judgement}</td><td class="num">${r.best}</td><td class="num">${r.traps}</td><td class="num">${r.index}</td></tr>`).join('')}</tbody></table></div>`:''}
   <div class="row"><button class="btn" data-act="replay">Save this run and play again</button><span class="small muted">Your actions stay on the list. Only the practice answers reset.</span></div></div>`;
}
function vDeck(){
  const dk=S.deck||{drawn:[],redraws:2};
  const keptIds=new Set(S.todos.filter(t=>t.source&&t.source.startsWith('w')).map(t=>t.source));
  const drawn=dk.drawn.map(id=>WILD.find(w=>w.id===id)).filter(Boolean);
  return `<div class="card"><div class="spread"><div><div class="eyebrow">Wildcard deck</div><h3>Bolder moves than you would choose on a normal Tuesday</h3></div><button class="btn small" data-act="draw" ${drawn.length&&!dk.redraws?'disabled':''}>${drawn.length?`Redraw three (${dk.redraws} left)`:'Draw three'}</button></div>
   <p class="small muted">Keep any that make you slightly uncomfortable. That is usually the signal. Each card you keep goes onto your actions, and a done wildcard scores 20 extra points.</p>
   ${drawn.length?`<div class="wild">${drawn.map(w=>{const k=keptIds.has(w.id);return `<div class="wcard ${k?'kept':''}"><span class="tag">${HORIZONS[w.h]}${w.hours?` &middot; ${w.hours} hrs/wk back`:''}</span><h3>${esc(w.title)}</h3><p>${esc(w.what)}</p><div><button class="btn small ${k?'ghost':''}" data-keep="${w.id}">${k?'Kept. Remove':'Keep this one'}</button></div></div>`;}).join('')}</div>`:''}
  </div>`;
}
function vCalls(){
  const pr=practice();
  let cur=S.callId==='results'?null:(S.callId&&findCall(S.callId));
  if(!cur&&S.callId!=='results')cur=S.calls.find(c=>S.answers[c.id]==null)||FOUNDING.find(c=>S.answers[c.id]==null)||null;
  const isFounding=cur&&FOUNDING.includes(cur);
  const dots=`<div class="dots">${FOUNDING.map((c,i)=>`<button class="dot ${S.answers[c.id]!=null?'done':''} ${cur&&cur.id===c.id?'cur':''}" data-opencall="${c.id}" aria-label="${esc(c.title)}">${i+1}</button>`).join('')}<button class="dot ${!cur?'cur':''}" data-opencall="results" aria-label="Results">=</button>${S.calls.map((c,i)=>`<button class="dot weekly ${S.answers[c.id]!=null?'done':''} ${cur&&cur.id===c.id?'cur':''}" data-opencall="${c.id}" aria-label="${esc(c.title)}">W${i+1}</button>`).join('')}</div>`;
  let body='';
  if(cur){
    const a=S.answers[cur.id];
    body=`<div class="card"><div class="eyebrow">${isFounding?`Call ${FOUNDING.indexOf(cur)+1} of 10`:'Weekly call &middot; '+fmtDate(cur.ts||Date.now())+(cur.gen==='claude'?' &middot; written for your week':'')} &middot; ${esc(cur.title)}</div><div class="scene">${esc(cur.scene)}</div>
     <div class="opts">${cur.opts.map((o,i)=>`<button class="opt ${a===i?'picked':a!=null?'dim':''}" data-pick="${i}" data-call="${cur.id}"><span class="k">${'ABC'[i]}</span><span>${esc(o.t)}</span></button>`).join('')}</div>`;
    if(a!=null){
      const o=cur.opts[a];const vl={best:'World-class call',ok:'Workable',trap:'The trap'}[o.v]||'Workable';const best=cur.opts.find(x=>x.v==='best');const dl=deltaFor(cur,a);
      body+=`<div class="row"><span class="verdict v-${o.v}">${vl}</span>${isFounding?dl.map((x,i)=>x?`<span class="chip ${x>0?'delta-up':'delta-down'}">${x>0?'+':''}${x} ${METERS[i].name}</span>`:'').join(''):''}</div><p>${esc(o.n)}</p>
       <div class="coach"><div class="eyebrow">The coaching</div>${cur.coach.map(p=>`<p>${esc(p)}</p>`).join('')}${o.v!=='best'&&best?`<p class="muted">The world-class call: ${esc(best.t)}</p>`:''}</div>
       <div class="added">On your list (${HORIZONS[cur.todo.h].toLowerCase()}): ${esc(cur.todo.text)}</div>
       ${isFounding?`<div class="row"><button class="btn" data-act="nextCall">${FOUNDING.some((c,i)=>i>FOUNDING.indexOf(cur)&&S.answers[c.id]==null)||FOUNDING.some(c=>S.answers[c.id]==null)?'Next call':'See your results'}</button></div>`:''}`;
    }
    body+='</div>';
  }else body=vResults(pr);
  return `<section>
   <div class="card"><div><div class="eyebrow">Play</div><h2>Practise the judgement. Score it in real life.</h2></div><p class="muted">Play the founding ten as a practice round and beat your best judgement score. Draw wildcards. A new weekly call is dealt after every Friday review${S.pendingCall?', and one is waiting for you now':''}. Every call puts an action on your list; ledger points come when you do it.</p>${S.pendingCall?'<div><button class="btn small" data-act="dealCall">Deal this week’s call</button></div>':''}</div>
   ${!cur||isFounding?vPracticePanel(pr):''}
   ${dots}${body}${vDeck()}</section>`;
}
/* ---------- Future ---------- */
function vFuture(){
  const f=S.future;const chosenGames=GAMES.filter(g=>g.kind==='chosen');
  return `<section>
  <div class="card"><div><div class="eyebrow">Creating your future</div><h2>Decide from the life you want, not from habit.</h2></div>
   <p class="muted">You build clients a budget before the year starts so every week can be judged against it. This is the budget for your life. Everything else in the ledger is measured against what you write here.</p></div>

  <div class="card"><div class="eyebrow">The game you choose</div><h3>What game are you playing in real life?</h3>
   <p class="small muted">Every founder is playing a game, chosen or not. The defaults are being needed, firefighting, proving yourself, pleasing everyone. Choose one on purpose, then check each Friday whether that is the one that ran your week.</p>
   <div class="games">${chosenGames.map(g=>`<button class="game ${f.game===g.id?'sel':''}" data-choose="${g.id}" type="button"><span class="gk chosen">Chosen game</span><span class="gn">${esc(g.name)}</span><span class="gd">${esc(g.move)}</span></button>`).join('')}</div>
   <div class="field"><span class="lbl">The score that counts in your game (pick up to two)</span>${chipRow('score',PICK.score,{multi:true,max:2,act:'score',selected:PICK.score.filter(s=>(f.gameWords||'').includes(s))})}</div>
   <details class="own"><summary>In my own words</summary><textarea id="f-gameWords" data-future="gameWords" placeholder="How you win, and the score that counts">${esc(f.gameWords)}</textarea></details></div>

  <div class="card"><div class="eyebrow">Your numbers</div><h3>The ideal week in figures</h3>
   <div class="grid2">
    <div class="field"><label for="f-targetHours">Target hours a week</label><span class="hint">The Architect level asks you to hit this for four reviews running.</span><input type="number" id="f-targetHours" data-future="targetHours" value="${f.targetHours}" min="10" max="90"></div>
    <div class="field"><label for="f-daysOff">Days fully off a year</label><span class="hint">Phone off. Not checking in.</span><input type="number" id="f-daysOff" data-future="daysOff" value="${f.daysOff}" min="0" max="120"></div>
    <div class="field"><label for="f-income">Target personal income (£ a year)</label><span class="hint">Salary plus dividends. Back-solve the EBITDA from it.</span><input type="number" id="f-income" data-future="income" value="${f.income||''}" min="0" step="5000" placeholder="Set it"></div>
    <div class="field"><label for="f-hourly">Value of one of your hours (£)</label><span class="hint">Values the hours you buy back. Set at £200 until you change it. Try your target income divided by your target hours a year.</span><input type="number" id="f-hourly" data-future="hourly" value="${f.hourly}" min="0" step="10"></div>
   </div>
   ${f.income&&f.targetHours?`<p class="small">Your target income over ${f.targetHours} hours a week for 46 weeks values your time at ${gbp(f.income/(f.targetHours*46))} an hour.</p>`:''}</div>

  <div class="card"><div class="eyebrow">Life pillars</div><h3>What does ten out of ten look like?</h3>
   <p class="small muted">Score each pillar as it is now, and tap what ten looks like in 2030. The gap is where the next wildcard should come from.</p>
   <div class="pillars">${PILLARS.map(([k,n])=>`<div class="field"><label for="p-${k}">${n}</label><div class="rate-line"><input type="range" id="p-${k}" min="1" max="10" value="${f.pillars[k].now}" data-pillar="${k}" data-out="op-${k}"><output id="op-${k}">${f.pillars[k].now}</output></div><span class="hint">Ten looks like:</span>${chipRow('pt-'+k,PICK.pillars[k],{act:'pillar',selected:f.pillars[k].ten})}<details class="own"><summary>My own words</summary><input type="text" id="pt-${k}" data-pillarten="${k}" value="${esc(f.pillars[k].ten)}" placeholder="Ten looks like..."></details></div>`).join('')}</div></div>

  ${vLetter()}

  ${S.baseline?`<div class="card"><div class="eyebrow">Opening position &middot; ${fmtDate(S.baselineTs||Date.now())}</div><p class="small">${METERS.map(m=>m.name+' '+S.baseline[m.k]).join(' &middot; ')} &middot; ${S.baseline.hours} hours</p>${S.baseline.oneThing?`<p class="small muted">The one change: ${esc(S.baseline.oneThing)}</p>`:''}</div>`:''}
  </section>`;
}

function render(){
  renderBoard();renderTabs();
  const v={today:vToday,review:vReview,actions:vActions,calls:vCalls,future:vFuture}[S.view]||vToday;
  $('#view').innerHTML=v();
}

/* ---------- Persistence: the host saves; this only reports every change ---------- */
let sampleNs;
function setStatus(t){const el=$('#status');if(el)el.textContent=t;}
function save(){S.updatedAt=Date.now();if(opts.onChange)opts.onChange(JSON.parse(JSON.stringify(S)));}

/* ---------- Weekly call ---------- */
const clean=s=>String(s||'').replace(/\s*[—–]\s*/g,', ').trim();
function validCall(c){
  return c&&typeof c.title==='string'&&typeof c.scene==='string'&&Array.isArray(c.opts)&&c.opts.length===3&&c.opts.every(o=>o&&o.t&&o.n&&['best','ok','trap'].includes(o.v))&&c.opts.some(o=>o.v==='best')&&Array.isArray(c.coach)&&c.coach.length&&c.todo&&c.todo.text;
}
function context(){
  const r=S.reviews[S.reviews.length-1]||{};
  const low=METERS.slice().sort((a,b)=>Number(r[a.k]||5)-Number(r[b.k]||5))[0];
  return {
    role:'Founder, CEO and CFO of Williams, Stanley & Co, a London accountancy firm serving only hospitality businesses. Chartered accountant and tax adviser. The firm sells a 3-day close, weekly KPI dashboards and numbers that drive action.',
    latestScores:METERS.map(m=>m.name+' '+(r[m.k]||'?')+'/10').join(', '),
    lowestLine:low.name,hoursWorked:r.hours,targetHours:S.future.targetHours,
    gamePlayedThisWeek:(GAMES.find(g=>g.id===r.game)||{}).name||'not given',
    chosenGame:(GAMES.find(g=>g.id===S.future.game)||{}).name||'not chosen yet',
    goodThings:(r.good||[]).filter(Boolean),space:r.space||'',workedInSystem:r.inSystem||'',change:r.change||'',
    openActions:S.todos.filter(t=>!t.done).slice(0,8).map(t=>t.text),
    previousCallTitles:allCalls().map(c=>c.title)
  };
}
async function dealCall(btn){
  if(btn){btn.disabled=true;btn.textContent='Writing your call...';}
  let call=null;
  try{
    if(AI&&!sampleNs&&window.claude&&window.claude.use)sampleNs=await window.claude.use('sample');
    if(sampleNs){
      const prompt=`You are a world-class CEO coach. Write ONE new coaching dilemma ("call") for this founder, based on their week. Context as JSON:\n${JSON.stringify(context())}\n\nRules: British English. Blunt, direct, specific to running an accountancy firm for hospitality clients. No emojis. Never use em dashes or en dashes. Target the lowest line, the game they actually played, or the place they worked in the system. Rotate across themes: delegation, pricing and margin, the CFO hat, people, focus, noticing positives, creating space, the game they are playing, designing their ideal life. Do not repeat a previous call title. Exactly three options: one "best", one "ok", one "trap" (order shuffled). Each option's "n" is one or two sentences on the consequence. "coach" is two short paragraphs explaining the thinking as a CEO would to a peer. "todo" is one concrete action they can do within the horizon.\nReturn only JSON: {"title":string,"scene":string,"opts":[{"t":string,"v":"best"|"ok"|"trap","n":string}],"coach":[string,string],"todo":{"text":string,"type":"Start"|"Stop"|"Keep","h":"week"|"month"|"quarter","hours":number}}`;
      const res=await sampleNs.json(prompt,{modelTier:'default',cache:false});
      if(validCall(res)){
        call={title:clean(res.title),scene:clean(res.scene),opts:res.opts.slice(0,3).map(o=>({t:clean(o.t),v:o.v,n:clean(o.n)})),coach:res.coach.slice(0,3).map(clean),
          todo:{text:clean(res.todo.text),type:['Start','Stop','Keep'].includes(res.todo.type)?res.todo.type:'Start',h:HORIZONS[res.todo.h]?res.todo.h:'week',hours:Math.max(0,Math.min(20,Number(res.todo.hours)||0))},gen:'claude'};
      }
    }
  }catch(e){}
  if(!call){
    const used=new Set(S.calls.map(c=>c.bank));
    const pool=BANK.filter(b=>!used.has(b.id));const pick=(pool.length?pool:BANK)[Math.floor(Math.random()*(pool.length||BANK.length))];
    call=JSON.parse(JSON.stringify(pick));call.bank=pick.id;call.gen='bank';
  }
  call.id='c'+uid();call.ts=Date.now();
  S.calls.push(call);S.pendingCall=false;S.view='calls';S.callId=call.id;save();render();window.scrollTo({top:0});
}

/* ---------- 2030 letter ---------- */
function renderLetter(){const el=byId('letter');if(!el){render();return;}el.outerHTML=vLetter();renderBoard();}
async function getSample(){if(AI&&!sampleNs&&window.claude&&window.claude.use){try{sampleNs=await window.claude.use('sample');}catch(e){}}return sampleNs;}
function letterContext(){
  const f=S.future,ans=S.letterQ.answers||{};
  return {
    answers:LETTER_Q.filter(x=>(ans[x.id]||'').trim()).map(x=>({question:x.q,answer:ans[x.id].trim()})),
    numbers:{targetHoursPerWeek:f.targetHours,daysFullyOffPerYear:f.daysOff,targetIncomeGBP:f.income||null},
    pillarsTenOutOfTen:PILLARS.filter(([k])=>(f.pillars[k].ten||'').trim()).map(([k,n])=>n+': '+f.pillars[k].ten.trim()),
    chosenGame:(GAMES.find(g=>g.id===f.game)||{}).name||null,gameInOwnWords:f.gameWords||null
  };
}
async function draftLetter(btn){
  btn.disabled=true;btn.textContent='Drafting...';
  let text='',by='bank';
  const s=await getSample();
  if(s){
    try{
      const prompt=`Write a first draft of a "2030 letter" for Tom Stanley, founder, CEO and CFO of Williams, Stanley & Co, a London accountancy firm that works only with hospitality businesses. He is a chartered accountant and tax adviser, and a former restaurateur. The letter is from Tom in November 2030 to Tom in November 2026, describing his life and firm as if it has all already happened.\n\nUse ONLY what he has told you below. Do not invent facts, names or figures he has not given. Where he gave a figure, use it exactly. If a part of life is missing, leave it out rather than making it up.\n\nHis material, as JSON:\n${JSON.stringify(letterContext())}\n\nStyle: first person, past and present tense only (it has happened), never "will" or "hope". British English. Plain, direct, warm, the way a confident operator talks. Concrete detail over slogans. No emojis. Never use em dashes or en dashes. No headings or bullet points. Open with "Dear Tom," and a line placing him on a specific morning in November 2030. Then short paragraphs: the firm, his role and what he stopped doing, a normal week, money, the people who run things, health, family and friends, adventure, the game he stopped playing. End with what he is glad 2026 Tom started, and sign off "Tom, November 2030". 300 to 500 words. Return only the letter text.`;
      const r=await s(prompt,{modelTier:'default',cache:false});
      if(r&&r.text&&wc(r.text)>80){text=r.text.replace(/\s*[—–]\s*/g,', ').trim();by='claude';}
    }catch(e){}
  }
  if(!text){
    const ans=S.letterQ.answers||{};
    const paras=LETTER_Q.filter(x=>x.id!=='thank'&&(ans[x.id]||'').trim()).map(x=>ans[x.id].trim());
    const th=(ans.thank||'').trim();
    text='Dear Tom,\n\nIt is November 2030. Here is how it turned out.\n\n'+paras.join('\n\n')+(th?`\n\nI am glad you started this in 2026: ${th}`:'')+'\n\nTom, November 2030';
  }
  S.letterDraft=text;S.letterDraftBy=by;save();renderLetter();
  setStatus(by==='claude'?'Draft ready. Read it out loud and change anything that does not sound like you.':(AI?'Claude was not available, so your answers have been set out as a letter. Edit them into your own words.':'Your answers are set out as a letter. Now rewrite them in your own words: that is where the thinking happens.'));
}
async function coachLetter(btn){
  btn.disabled=true;btn.textContent='Reading your letter...';
  const t=S.future.letter||'';
  const out={ts:Date.now(),checks:letterChecks(t),ai:null,aiTried:false};
  const s=await getSample();
  if(s){
    out.aiTried=true;
    try{
      const prompt=`You are a world-class CEO coach reading your client's "2030 letter": a letter from himself in November 2030 describing the life and firm he has built. He is Tom Stanley, founder, CEO and CFO of Williams, Stanley & Co, a London accountancy firm for hospitality businesses. Coach him to make it sharper, more specific and more honest, so it works as a decision filter he reads every month.\n\nHis letter:\n"""${t.slice(0,8000)}"""\n\nHis stated numbers and chosen game: ${JSON.stringify({targetHours:S.future.targetHours,daysOff:S.future.daysOff,income:S.future.income||null,game:(GAMES.find(g=>g.id===S.future.game)||{}).name||null})}\n\nRules: British English, blunt and specific, no flattery, no emojis, never use em dashes or en dashes. Quote his own words exactly when you challenge a line.\nReturn only JSON: {"strengths":[one or two short sentences],"sharpen":[up to three {"quote":exact short phrase from the letter,"question":a coaching question or challenge that would make that line more concrete or more truthful}],"missing":[up to two short sentences on what a full life plan would include that this letter does not],"firstAction":one concrete action he could take this week that moves him toward this letter}`;
      const r=await s.json(prompt,{modelTier:'default',cache:false});
      if(r&&typeof r==='object'){const cl=x=>String(x||'').replace(/\s*[—–]\s*/g,', ').trim();
        out.ai={strengths:(r.strengths||[]).slice(0,2).map(cl),sharpen:(r.sharpen||[]).slice(0,3).filter(x=>x&&x.question).map(x=>({quote:cl(x.quote),question:cl(x.question)})),missing:(r.missing||[]).slice(0,2).map(cl),firstAction:cl(r.firstAction)};}
    }catch(e){}
  }
  S.letterCoach=out;save();renderLetter();
}

function attach(){
/* ---------- Events ---------- */
let reviewGame='';
on('input',e=>{
  const t=e.target;
  if(t.dataset.out){const o=byId(t.dataset.out);if(o)o.textContent=t.value;}
  if(t.dataset.future){const k=t.dataset.future;S.future[k]=t.type==='number'?Number(t.value):t.value;save();if(t.type==='number')renderBoard();}
  if(t.dataset.lq){S.letterQ.answers[t.dataset.lq]=t.value;save();}
  if(t.dataset.pillar){S.future.pillars[t.dataset.pillar].now=Number(t.value);save();}
  if(t.dataset.pillarten){S.future.pillars[t.dataset.pillarten].ten=t.value;save();}
  if(t.dataset.hrs){const it=S.todos.find(x=>x.id===t.dataset.hrs);it.hours=Math.max(0,Number(t.value)||0);save();renderBoard();}
});
on('submit',e=>{
  e.preventDefault();
  if(e.target.id==='addForm'){const txt=$('#addText').value.trim();if(!txt)return;addTodo({text:txt,type:$('#addType').value,h:$('#addH').value,hours:Number($('#addHrs').value)||0});save();render();$('#addText').focus();}
  if(e.target.id==='noticeForm'){const txt=$('#noticeText').value.trim();if(!txt)return;const kind=(e.submitter&&e.submitter.dataset.kind)||'good';S.notes.push({ts:Date.now(),kind,text:txt});if(S.notes.length>400)S.notes=S.notes.slice(-400);save();render();setStatus(kind==='good'?'Noticed. Find the cause and you can repeat it.':'Noticed. Protect the next one before it fills.');}
});
on('change',e=>{
  const id=e.target.dataset.done;
  if(id){const t=S.todos.find(x=>x.id===id);t.done=e.target.checked;t.doneAt=t.done?Date.now():null;if(t.done)t.star=false;save();
    if(S.view==='review'){renderBoard();setStatus(t.done?`+${PTS[t.type]} points`:'Unticked');}else render();}
});
on('click',async e=>{
  const b=e.target.closest('button');if(!b)return;const d=b.dataset;
  if(d.other){const i=byId('other-'+d.other);if(i){i.hidden=!i.hidden;b.classList.toggle('sel',!i.hidden);if(!i.hidden)i.focus();}return;}
  if(d.pickGroup){
    const row=b.closest('.chips-row');const multi=row&&row.dataset.multi==='1';const max=Number(row&&row.dataset.max)||0;
    if(multi){
      if(!b.classList.contains('sel')&&max&&row.querySelectorAll('.pick.sel:not(.other)').length>=max){setStatus(`Pick up to ${max}.`);return;}
      b.classList.toggle('sel');
    }else{
      row.querySelectorAll('.pick').forEach(x=>{if(x!==b)x.classList.remove('sel');});b.classList.add('sel');
      const o=byId('other-'+d.pickGroup);if(o)o.hidden=true;
    }
    const v=d.val;
    switch(d.pact){
      case 'note-good':case 'note-space':{const kind=d.pact==='note-good'?'good':'space';S.notes.push({ts:Date.now(),kind,text:v});if(S.notes.length>400)S.notes=S.notes.slice(-400);save();render();setStatus(kind==='good'?'Noticed. Find the cause and you can repeat it.':'Noticed. Protect the next one before it fills.');break;}
      case 'lq':{const id=d.pickGroup.slice(3);S.letterQ.answers[id]=v;const st=S.letterQ.step||0;if(st<LETTER_Q.length-1)S.letterQ.step=st+1;save();renderLetter();setStatus('Saved. Next question.');
        if(st>=LETTER_Q.length-1){addTodo({text:v,type:'Start',h:'week',hours:0,source:'letter-thank'});save();setStatus('Your first step is on the list. Now draft the letter.');}break;}
      case 'decline':{S.wildMonth.decision='declined';S.wildMonth.reason=v;S.wildLog.push({month:S.wildMonth.month,id:S.wildMonth.id,decision:'declined',reason:v});save();render();break;}
      case 'score':{const s=picked('score');S.future.gameWords=s.length?'The score that counts: '+s.join(' and ')+'.':'';save();const ta=byId('f-gameWords');if(ta)ta.value=S.future.gameWords;break;}
      case 'pillar':{const k=d.pickGroup.slice(3);S.future.pillars[k].ten=v;save();const i=byId('pt-'+k);if(i)i.value=v;break;}
    }
    return;
  }
  if(d.tab){S.view=d.tab;save();render();window.scrollTo({top:0});return;}
  if(d.goto){S.view='future';save();render();const el=byId(d.goto);if(el)el.scrollIntoView({block:'start'});return;}
  if(d.lqstep!=null){S.letterQ.step=Number(d.lqstep);save();renderLetter();return;}
  if(d.keep){const w=WILD.find(x=>x.id===d.keep);const ex=S.todos.find(t=>t.source===w.id);
    if(ex){if(ex.done){setStatus('Already done. It stays on your list.');return;}S.todos=S.todos.filter(t=>t!==ex);S.wildLog=S.wildLog.filter(x=>!(x.id===w.id&&x.month==='deck'));}
    else{addTodo({text:w.todo,type:w.type,h:w.h,hours:w.hours,source:w.id});S.wildLog.push({month:'deck',id:w.id,decision:'accepted',reason:''});}
    save();render();return;}
  if(d.opencall){S.view='calls';S.callId=d.opencall;save();render();return;}
  if(d.pick!=null){const c=findCall(d.call);S.answers[c.id]=Number(d.pick);S.callId=c.id;addTodo({text:c.todo.text,type:c.todo.type,h:c.todo.h,hours:c.todo.hours||0,source:c.bank||c.id});save();render();return;}
  if(d.star){const t=S.todos.find(x=>x.id===d.star);if(!t.star&&S.todos.filter(x=>x.star&&!x.done).length>=3){setStatus('Three is the limit. Unstar one first.');return;}t.star=!t.star;save();render();return;}
  if(d.del){S.todos=S.todos.filter(x=>x.id!==d.del);save();render();return;}
  if(d.game){reviewGame=d.game;ROOT.querySelectorAll('[data-game]').forEach(x=>x.classList.toggle('sel',x.dataset.game===d.game));const g=GAMES.find(x=>x.id===d.game);
    $('#gameNote').innerHTML=`<div class="coach"><p><span class="${g.kind==='chosen'?'delta-up':'delta-down'}">${esc(g.name)}.</span> It pays: ${esc(g.payoff)} It costs: ${esc(g.cost)}</p><p>The move: ${esc(g.move)}</p></div>`;return;}
  if(d.choose){S.future.game=d.choose;save();render();return;}
  switch(d.act){
    case 'saveBaseline':{
      const keep=picked('b-protect')[0]||'';
      const bl={hours:parseInt(picked('b-hours')[0]||'55',10),oneThing:picked('b-one')[0]||'',protect:keep==='Nothing yet'?'':keep};
      METERS.forEach(m=>bl[m.k]=Number($('#b-'+m.k).value));
      S.baseline=bl;S.baselineTs=Date.now();
      if(bl.oneThing)addTodo({text:bl.oneThing,type:'Start',h:'week',hours:2,source:'audit-one'});
      if(bl.protect)addTodo({text:'Protect: '+bl.protect,type:'Keep',h:'week',hours:0,source:'audit-keep'});
      save();render();break;}
    case 'review':{
      const none=v=>v&&v!=='None this week'?v:'';
      const good=picked('rv-good').slice(0,3);
      const r={ts:Date.now(),hours:parseInt(picked('rv-hours')[0]||'0',10),good,space:none(picked('rv-space')[0]),game:reviewGame,inSystem:none(picked('rv-system')[0]),win:good[0]||'',change:picked('rv-change')[0]||''};
      METERS.forEach(m=>r[m.k]=Number($('#rv-'+m.k).value));
      const before=points();
      if(S.reviews.length&&r.ts-S.reviews[S.reviews.length-1].ts<4*DAY)S.reviews[S.reviews.length-1]=r;else{S.reviews.push(r);S.pendingCall=true;}
      r.good.forEach(g=>S.notes.push({ts:r.ts,kind:'good',text:g}));
      if(r.space)S.notes.push({ts:r.ts,kind:'space',text:r.space});
      if(r.change)addTodo({text:r.change,type:'Start',h:'week',hours:0,source:'review-'+r.ts});
      if(r.inSystem)addTodo({text:'Design out: '+r.inSystem,type:'Stop',h:'month',hours:1,source:'review-sys-'+r.ts});
      reviewGame='';S.view='today';save();render();window.scrollTo({top:0});
      const gained=points()-before;
      $('#view').insertAdjacentHTML('afterbegin',`<div class="toast"><strong>Week closed. +${gained} points, streak ${streak()} week${streak()===1?'':'s'}.</strong><span class="small">${S.pendingCall?'Your next call is ready to deal below.':'Review updated.'}</span></div>`);
      break;}
    case 'dealCall':dealCall(b);break;
    case 'nextCall':{const i=FOUNDING.findIndex(c=>c.id===S.callId);const nx=FOUNDING.slice(i+1).find(c=>S.answers[c.id]==null)||FOUNDING.find(c=>S.answers[c.id]==null);S.callId=nx?nx.id:'results';save();render();window.scrollTo({top:0});break;}
    case 'replay':{const pr=practice();S.practiceRuns=(S.practiceRuns||[]).concat({ts:Date.now(),judgement:pr.judgement,best:pr.best.length,traps:pr.traps.length,index:pr.index});FOUNDING.forEach(c=>delete S.answers[c.id]);S.callId=FOUNDING[0].id;S.deck={drawn:[],redraws:2};save();render();window.scrollTo({top:0});break;}
    case 'draw':{const dk=S.deck=S.deck||{drawn:[],redraws:2};if(dk.drawn.length){if(!dk.redraws)return;dk.redraws--;}
      const kept=new Set(S.todos.filter(t=>t.source&&t.source.startsWith('w')).map(t=>t.source));
      let pool=WILD.filter(w=>!kept.has(w.id)&&!dk.drawn.includes(w.id));if(pool.length<3)pool=WILD.filter(w=>!kept.has(w.id));if(pool.length<3)pool=WILD.slice();
      dk.drawn=pool.slice().sort(()=>Math.random()-.5).slice(0,3).map(w=>w.id);save();render();break;}
    case 'lqPrev':S.letterQ.step=Math.max(0,(S.letterQ.step||0)-1);save();renderLetter();break;
    case 'lqNext':{
      const st=S.letterQ.step||0;
      if(st<LETTER_Q.length-1){S.letterQ.step=st+1;save();renderLetter();const ta=ROOT.querySelector('[data-lq]');if(ta)ta.focus();}
      else{const th=(S.letterQ.answers.thank||'').trim();if(th)addTodo({text:th,type:'Start',h:'week',hours:0,source:'letter-thank'});save();render();
        const el=ROOT.querySelector('[data-act=draftLetter]');if(el)el.scrollIntoView({block:'center'});setStatus(th?'Your first step is on the list. Now draft the letter.':'Now draft the letter.');}
      break;}
    case 'draftLetter':draftLetter(b);break;
    case 'useDraft':S.future.letter=S.letterDraft;S.letterDraft='';S.letterCoach=null;save();render();byId('f-letter').scrollIntoView({block:'center'});setStatus('Draft moved into your letter. Edit until it sounds like you.');break;
    case 'discardDraft':S.letterDraft='';save();renderLetter();break;
    case 'coachLetter':coachLetter(b);break;
    case 'readLetter':S.letterReads=(S.letterReads||[]).concat(Date.now());save();render();byId('letter').scrollIntoView({block:'start'});setStatus('+10 points. Now pick one thing this week that 2030 you would want.');break;
    case 'addFirst':if(S.letterCoach&&S.letterCoach.ai&&S.letterCoach.ai.firstAction){addTodo({text:S.letterCoach.ai.firstAction,type:'Start',h:'week',hours:0,source:'letter-first'});save();setStatus('Added to this week’s actions');renderBoard();renderTabs();}break;
    case 'dealWild':{
      const seen=new Set(S.wildLog.map(x=>x.id));const pool=WILD.filter(w=>!seen.has(w.id));const src=pool.length?pool:WILD;
      const w=src[Math.floor(Math.random()*src.length)];S.wildMonth={month:monthKey(Date.now()),id:w.id,decision:null,reason:''};save();render();break;}
    case 'wildAccept':{const w=WILD.find(x=>x.id===S.wildMonth.id);S.wildMonth.decision='accepted';S.wildLog.push({month:S.wildMonth.month,id:w.id,decision:'accepted',reason:''});addTodo({text:w.todo,type:w.type,h:w.h,hours:w.hours,source:w.id});save();render();break;}
    case 'wildDecline':{const reason=$('#wildReason').value.trim();if(!reason){setStatus('Give a reason. A decline without one is drift.');$('#wildReason').focus();return;}S.wildMonth.decision='declined';S.wildMonth.reason=reason;S.wildLog.push({month:S.wildMonth.month,id:S.wildMonth.id,decision:'declined',reason});save();render();break;}
    case 'copy':{
      const txt=Object.entries(HORIZONS).map(([h,l])=>{const it=S.todos.filter(t=>t.h===h);return it.length?l.toUpperCase()+'\n'+it.map(t=>`[${t.done?'x':' '}] ${t.type}: ${t.text}`).join('\n'):'';}).filter(Boolean).join('\n\n');
      try{await navigator.clipboard.writeText(txt);setStatus('Copied to clipboard');}
      catch(err){const ta=document.createElement('textarea');ta.value=txt;ta.style.minHeight='200px';b.closest('.card').appendChild(ta);ta.select();setStatus('Select all and copy the text box at the bottom of the list');}
      break;}
  }
});

}



return {
  get state() { return S; },
  set state(v) { S = migrate(v); },
  migrate, points, streak, boughtBack, levels, practice, letterChecks, ceoIndex, reviewDue, addTodo, deltaFor,
  FOUNDING, BANK, WILD, LETTER_Q, GAMES, PTS, PICK, LETTER_PICKS,
  mount() {
    ROOT.innerHTML = MARKUP;
    attach();
    render();
    return () => { offs.splice(0).forEach(f => f()); ROOT.innerHTML = ''; };
  },
};
}
