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
const MARKUP = '<div class="wrap">\n  <header>\n    <div class="eyebrow">Williams, Stanley &amp; Co. &middot; CEO coaching</div>\n    <h1>The Founder\'s Ledger</h1>\n    <p class="muted">Points come from what you do, not what you answer. Close your own week every Friday, buy your hours back, and build the life you have written down.</p>\n  </header>\n  <button type="button" class="btn reset-top" id="resetTop" data-tab="reset">Loud day? Reset in three minutes</button>\n  <div class="board" id="board"></div>\n  <nav id="tabs" aria-label="Sections"></nav>\n  <main id="view"></main>\n  <div class="status" id="status" aria-live="polite"></div>\n</div>';

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
/* ---------- The Reset: three minutes, played as often as a hard day needs, always ending in a move ----------
   Built for days that are loud. Name it, sort it, see one receipt from your own ledger, pick one move under
   fifteen minutes, then go and do it. A reset never takes points away and never touches the streak. Its move
   scores only when ticked, and only the first three a day score, so the ledger never rewards reaching for it. */
const RESET_CAP=6;
const LOUD=[
 {k:'cash',name:'Cash'},
 {k:'client',name:'A client'},
 {k:'person',name:'Someone on the team'},
 {k:'load',name:'Too much on'},
 {k:'mistake',name:'A mistake'},
 {k:'future',name:'Where the firm is heading'},
 {k:'heavy',name:'Nothing specific, just heavy'}
];
const SORT=[
 {k:'decide',name:'Mine to decide',coach:'Then it is a decision, not a worry. Decisions get made, scheduled or handed over. Worries just loop.'},
 {k:'influence',name:'Mine to influence',coach:'You cannot decide it alone, but you can move it. One conversation or one message usually moves it most.'},
 {k:'not',name:'Not mine',coach:'Then carrying it is not leadership, it is weight. Write it down, park it, and put your next hour where it counts.'}
];
const MOVES={
  cash:['Write today’s bank balance down, actual not feared','Chase the oldest debtor with one email','Sketch the next 13 weeks of cash on one page','Ask for a cash forecast on my desk by Friday'],
  client:['Write the one sentence I want the client to hear','Ask the account manager for their recommendation','Book a 15-minute call with the client','Write what a fair outcome looks like for both sides'],
  person:['Write the standard they are missing in one sentence','Book the conversation in the diary this week','Ask how they see it before I say how I see it','Thank someone who got something right today'],
  load:['Write everything down, then circle one','Hand one item over with an owner and a date','Cancel or shorten one meeting today','Close email for the next 60 minutes'],
  mistake:['Write what happened in three lines, facts only','Tell the person affected, today, plainly','Name the check that would have caught it','Name who owns the fix to the cause'],
  future:['Read my 2030 letter','Write the one decision that would move the firm most this quarter','Book a two-hour thinking block this week','Write down three things going well that nobody has noticed'],
  heavy:['Ten-minute walk, no phone','Water, five slow breaths, then one small task','Tell someone I trust how today is going','Finish one small thing I have been putting off'],
  not:['Write it down and park it until Friday','Name who does own it and tell them','Ten-minute walk, no phone']
};
/* When the same thing is loud on three days in a week it is a system problem, and the Friday review says so. */
const FIX={
  cash:{text:'Build a 13-week cash flow and read it every Monday at 9.',type:'Start',h:'week',hours:1},
  client:{text:'Write the client standard: what we do, what we charge, and when we walk away.',type:'Start',h:'month',hours:1},
  person:{text:'Hold the overdue conversation: gap, standard, thirty days, support.',type:'Start',h:'week',hours:1},
  load:{text:'Cut one recurring commitment for good and tell the people affected.',type:'Stop',h:'week',hours:2},
  mistake:{text:'Add the missing check to the process and give it a named owner.',type:'Start',h:'month',hours:1},
  future:{text:'Book a monthly two-hour strategy block with one question written down.',type:'Start',h:'month',hours:0},
  heavy:{text:'Book a proper conversation with someone outside the firm about how this year is going.',type:'Start',h:'week',hours:0}
};
/* Short calls for a pressure moment. Answering scores nothing and adds nothing to the list: the move does that. */
const PRESSURE=[
 {id:'p-cash1',k:'cash',title:'Thursday’s forecast',scene:'The cash forecast shows a dip below your comfort line in three weeks. Payroll is the week after.',
  opts:[{t:'Lie awake running the numbers.',v:'trap',n:'You did the worrying and none of the work. The numbers are the same at 7am.'},{t:'List the three levers: collect, delay, draw. Pick the first one and act on it today.',v:'best',n:'A dip you can see three weeks out is a plan, not a crisis.'},{t:'Wait for next week’s forecast to confirm it.',v:'ok',n:'Sometimes right. Usually it burns a week you will want back.'}],
  coach:['You tell clients every week that a forecast is a gift: it shows the problem while there is still time. Take your own advice.']},
 {id:'p-cash2',k:'cash',title:'The slow payer',scene:'Your second-largest client is 60 days late. They are friendly and always apologetic.',
  opts:[{t:'Leave it. The relationship matters more.',v:'trap',n:'They are using your balance sheet as their overdraft, at your expense.'},{t:'Call the owner, agree a date, and put the account on terms from next month.',v:'best',n:'Clear, kind and done in one conversation.'},{t:'Have the team send a firmer reminder.',v:'ok',n:'It may work. The owner-to-owner call works faster.'}],
  coach:['A client who pays late is borrowing from you without asking. Saying so plainly is not rude. It is the job.']},
 {id:'p-cash3',k:'cash',title:'3am arithmetic',scene:'You wake at 3am and start rebuilding the P&L in your head.',
  opts:[{t:'Get up and open the laptop.',v:'trap',n:'Tired judgement on half the facts. Tomorrow pays for tonight.'},{t:'Write the worry on paper by the bed, one line, then back to sleep. Look at it at 9.',v:'best',n:'The thought is parked where you can find it. Your head is allowed to stop.'},{t:'Lie there and try not to think about it.',v:'ok',n:'Trying not to think about something is still thinking about it.'}],
  coach:['Nothing at 3am has ever been improved by a spreadsheet at 3am. Park it in writing. The 9am version of you is the CFO.']},
 {id:'p-cash4',k:'cash',title:'The quiet month',scene:'New business is slow this month and you start to wonder if the firm is in trouble.',
  opts:[{t:'Discount the next three proposals to win them.',v:'trap',n:'You have turned a quiet month into a lower-margin year.'},{t:'Check the facts: pipeline, retention, cash. Then decide whether it is a month or a trend.',v:'best',n:'One month is noise. Three is a trend. Know which you are looking at.'},{t:'Spend the week personally chasing leads.',v:'ok',n:'Useful energy. It also tells the team sales depend on you.'}],
  coach:['You would never let a client panic over one soft week of covers. Look at the trend, not the week.']},
 {id:'p-client1',k:'client',title:'The angry email',scene:'4pm. A client emails the whole team: the pack was late and they are “seriously reconsidering”.',
  opts:[{t:'Reply in full within ten minutes, defending the team.',v:'trap',n:'Fast and defensive. It reads as panic and escalates.'},{t:'Acknowledge within the hour, call tomorrow morning with the facts and the fix.',v:'best',n:'Calm, quick and specific. Most angry clients want to be heard and then to see a plan.'},{t:'Forward it to the manager to handle.',v:'ok',n:'Right owner, but a threatened exit deserves your voice once.'}],
  coach:['Speed of acknowledgement and speed of reply are different things. Acknowledge fast. Reply when you have the facts.']},
 {id:'p-client2',k:'client',title:'The fee conversation',scene:'You need to raise a long-standing client’s fee by 15 percent and you have put it off twice.',
  opts:[{t:'Put it off to the year end.',v:'trap',n:'Another quarter of work below cost, and a harder conversation later.'},{t:'Book it this week. Show what they get, the new fee, and the date it starts.',v:'best',n:'Value first, number second, date third. Done.'},{t:'Send it by email and hope they do not notice.',v:'ok',n:'They will notice. Say it to them.'}],
  coach:['The conversation you avoid does not get easier. It gets more expensive. Every month you wait is paid for in margin.']},
 {id:'p-client3',k:'client',title:'They want you, not the team',scene:'A big client says they only want to deal with you.',
  opts:[{t:'Agree. They are too important to risk.',v:'trap',n:'You have just made yourself the ceiling on that account.'},{t:'Introduce the manager in person, stay in the first two meetings, then step back on a stated date.',v:'best',n:'They get continuity and you get your time back.'},{t:'Hand them over by email.',v:'ok',n:'Correct direction, rough landing.'}],
  coach:['Clients ask for the founder because they have not yet met anyone as good. Your job is to introduce them to someone who is.']},
 {id:'p-client4',k:'client',title:'The lost client',scene:'A client you liked has moved to a cheaper firm.',
  opts:[{t:'Decide the firm is slipping.',v:'trap',n:'One loss is a data point, not a verdict.'},{t:'Ask them for ten honest minutes on why. Write down what you learn.',v:'best',n:'The cheapest research you will ever buy.'},{t:'Move on and say nothing.',v:'ok',n:'Dignified, and you learn nothing.'}],
  coach:['Some clients should leave. Find out whether this was one of them before you decide what it means.']},
 {id:'p-person1',k:'person',title:'The resignation',scene:'A good manager hands in their notice.',
  opts:[{t:'Counter-offer straight away, whatever it takes.',v:'trap',n:'Money rarely fixes the reason. They often leave within the year anyway.'},{t:'Ask why, listen properly, then decide. Start the handover plan either way.',v:'best',n:'You learn something and the firm is protected.'},{t:'Take their work on yourself for now.',v:'trap',n:'Now you have their job and yours.'}],
  coach:['People leave. Firms that survive it have the work written down and more than one person who can do it.']},
 {id:'p-person2',k:'person',title:'The difficult conversation',scene:'You need to tell someone senior their work is below standard. It is booked for tomorrow.',
  opts:[{t:'Soften it until the message is lost.',v:'trap',n:'They leave the room thinking it went well.'},{t:'Write the gap, the standard and the support on one card. Say it plainly and kindly.',v:'best',n:'Clear is kind. They know where they stand.'},{t:'Postpone it a week to prepare more.',v:'ok',n:'You are already prepared. The delay is for you, not them.'}],
  coach:['The kindest version of a hard message is the one that is understood the first time.']},
 {id:'p-person3',k:'person',title:'Team morale',scene:'The office feels flat. Two people seem quietly fed up.',
  opts:[{t:'Book a team social and hope.',v:'ok',n:'Nice. It treats the mood, not the cause.'},{t:'Have two short one-to-ones this week. Ask what is getting in their way.',v:'best',n:'You find the cause, and they see you noticed.'},{t:'Ignore it. Everyone has flat weeks.',v:'trap',n:'Sometimes true. Flat weeks become resignations when nobody asks.'}],
  coach:['Morale follows clarity and progress more than perks. Ask what is in the way and remove one thing.']},
 {id:'p-person4',k:'person',title:'The hire you are unsure about',scene:'Six weeks in, a new hire is slower than you hoped.',
  opts:[{t:'Decide they were a mistake.',v:'trap',n:'Six weeks is early. Most slow starts are onboarding problems.'},{t:'Check what they were given: training, standards, a named buddy. Fix the gaps, review at twelve weeks.',v:'best',n:'Fair to them and honest about your part.'},{t:'Redo their work yourself quietly.',v:'trap',n:'They never learn and you never stop.'}],
  coach:['Before judging a new starter, audit the start you gave them. That part was yours.']},
 {id:'p-load1',k:'load',title:'Forty things',scene:'Your list has forty things on it and they all feel urgent.',
  opts:[{t:'Work late and clear as many as possible.',v:'trap',n:'You will clear the easy ones and the hard ones will still be there.'},{t:'Pick the three that matter this week. Hand five over. Park the rest with a review date.',v:'best',n:'A list you can finish is a list you can lead from.'},{t:'Start with the oldest.',v:'ok',n:'Fair, but old is not the same as important.'}],
  coach:['Overwhelm is usually an undecided list, not a long one. Deciding is the work that makes it shorter.']},
 {id:'p-load2',k:'load',title:'Everyone needs you today',scene:'Five people want ten minutes with you before lunch.',
  opts:[{t:'See them all, one after another.',v:'trap',n:'Fifty minutes gone and five decisions taken off five people.'},{t:'Ask each for their recommendation in one line by message. Approve or discuss only the ones that need you.',v:'best',n:'Most will not need you once they have written it down.'},{t:'Tell them all to wait until tomorrow.',v:'ok',n:'Protects your morning and moves the queue to tomorrow.'}],
  coach:['If everyone needs you today, the firm has a decision-rights problem, not a time problem.']},
 {id:'p-load3',k:'load',title:'The holiday you cannot take',scene:'You have a week off booked and you are thinking of cancelling.',
  opts:[{t:'Cancel. Now is not the time.',v:'trap',n:'There will never be a time, until your health chooses one for you.'},{t:'Keep it. Write the who-decides-what list today and switch off.',v:'best',n:'Whatever breaks becomes your delegation list.'},{t:'Go, but check email twice a day.',v:'ok',n:'Half a holiday and half a job. Neither done well.'}],
  coach:['A firm that cannot survive a week without you is the clearest data you will get on what to fix next.']},
 {id:'p-load4',k:'load',title:'Saying yes again',scene:'Someone asks you to sit on a committee. It would be useful. You are already full.',
  opts:[{t:'Say yes. It would look bad to refuse.',v:'trap',n:'Your diary is now run by other people’s expectations.'},{t:'Check it against the 2030 letter. If it is not in there, decline kindly today.',v:'best',n:'Your letter said no for you.'},{t:'Say maybe and decide later.',v:'ok',n:'Maybe is a yes that costs you two more conversations.'}],
  coach:['Every yes is a no to something else. Make sure you know what you are saying no to.']},
 {id:'p-mistake1',k:'mistake',title:'The error in the pack',scene:'A client found an error in their management accounts. It was a team member’s, and you signed it off.',
  opts:[{t:'Fix it yourself tonight and say nothing.',v:'trap',n:'The cause stays in place and the team learns nothing.'},{t:'Own it to the client, fix it, then find the check that would have caught it.',v:'best',n:'The client trusts you more for the honesty. The process gets better.'},{t:'Tell the team member off.',v:'trap',n:'Blame makes people hide errors. Hidden errors cost more.'}],
  coach:['One error is a process problem until proven otherwise. Fix the check, not the person.']},
 {id:'p-mistake2',k:'mistake',title:'Your own mistake',scene:'You made a call last month that turned out wrong. It cost the firm money.',
  opts:[{t:'Go over it again and again tonight.',v:'trap',n:'Replaying it is not learning from it. It is paying for it twice.'},{t:'Write what you knew then, what you know now, and the one rule you will use next time.',v:'best',n:'A mistake turned into a rule is an asset.'},{t:'Never take that kind of decision again.',v:'ok',n:'Safe and limiting. Decisions are the job.'}],
  coach:['Judge a decision by what you knew when you made it, not by how it turned out. Then write the rule and let it go.']},
 {id:'p-mistake3',k:'mistake',title:'The deadline missed',scene:'A filing deadline was missed. A penalty is likely.',
  opts:[{t:'Hide it and hope HMRC is slow.',v:'trap',n:'It always comes out, and later it comes out worse.'},{t:'Tell the client today, file now, appeal if there is a case, and pay the penalty if not.',v:'best',n:'Honest, quick and the cost is capped.'},{t:'Wait until you know the penalty amount.',v:'ok',n:'The client should hear it from you before the letter arrives.'}],
  coach:['Bad news ages badly. The earlier the client hears it from you, the more they trust you afterwards.']},
 {id:'p-mistake4',k:'mistake',title:'The snap reply',scene:'You were short with a team member this morning. You have been thinking about it since.',
  opts:[{t:'Let it pass. They will have forgotten.',v:'trap',n:'They have not. People remember tone from the top.'},{t:'Find them, say you were short and that it was not about them. Thirty seconds.',v:'best',n:'Repair is a leadership skill. It costs almost nothing.'},{t:'Be extra nice for the rest of the week.',v:'ok',n:'Kind, but they are left guessing.'}],
  coach:['You will get it wrong sometimes. What people remember is whether you came back and fixed it.']},
 {id:'p-future1',k:'future',title:'Can I save this firm?',scene:'You catch yourself thinking the firm’s future rests entirely on you.',
  opts:[{t:'Work harder. If it rests on you, give it more.',v:'trap',n:'More of you is the problem you are trying to solve.'},{t:'Write the three things only you can do this quarter. Hand everything else to someone named.',v:'best',n:'You lead it. The team carries it with you.'},{t:'Hire someone senior and hope.',v:'ok',n:'Help is right. Hope is not a brief.'}],
  coach:['You do not save a firm alone. You lead the people who save it with you. Your part is the decisions, the standards and the people.']},
 {id:'p-future2',k:'future',title:'The competitor',scene:'A rival announces a new product that looks like yours, at a lower price.',
  opts:[{t:'Cut your prices to match.',v:'trap',n:'You have let them set your price and your margin.'},{t:'Ask five clients what they value most about WS. Lead with that.',v:'best',n:'Your clients tell you what to defend.'},{t:'Ignore it completely.',v:'ok',n:'Calm, but learn from it.'}],
  coach:['A competitor copying you is a sign you were right. Compete on what they cannot copy: the way your people work with operators.']},
 {id:'p-future3',k:'future',title:'The bad quarter',scene:'The quarter’s numbers are below plan and you feel like you are failing.',
  opts:[{t:'Decide the plan was wrong and stop measuring against it.',v:'trap',n:'You lose the one tool that tells you what to fix.'},{t:'Find the two lines that caused most of the gap. Fix those. Leave the rest.',v:'best',n:'Variance analysis on yourself. You do it for clients every week.'},{t:'Ask the team to work harder next quarter.',v:'ok',n:'Effort was rarely the gap.'}],
  coach:['A quarter below plan is a variance, not a verdict. Read it like you would read a client’s.']},
 {id:'p-future4',k:'future',title:'Is this still what I want?',scene:'Driving home you wonder whether you even want to be doing this in five years.',
  opts:[{t:'Push the thought away. There is too much to do.',v:'trap',n:'It will be back, louder.'},{t:'Book an hour this week to answer it on paper, using the 2030 letter.',v:'best',n:'A big question deserves a proper slot, not a car journey.'},{t:'Decide tonight.',v:'ok',n:'Big decisions made tired are made twice.'}],
  coach:['That question is not a crisis. It is the most useful question a founder can ask. Give it time on purpose.']},
 {id:'p-heavy1',k:'heavy',title:'The heavy morning',scene:'Nothing has gone wrong. It just feels heavy today.',
  opts:[{t:'Push through and pretend it is fine.',v:'trap',n:'It leaks out in tone and decisions anyway.'},{t:'Lower today’s bar: three things that matter, a walk at lunch, home on time.',v:'best',n:'A smaller day done well beats a big day done badly.'},{t:'Cancel everything and go home.',v:'ok',n:'Sometimes right. Usually a lighter day is better than an empty one.'}],
  coach:['Heavy days happen to every founder. Leading well on one means adjusting the load, not denying the weight.']},
 {id:'p-heavy2',k:'heavy',title:'Am I enough?',scene:'You catch yourself thinking you are not good enough to run this firm.',
  opts:[{t:'Work later to prove it.',v:'trap',n:'That is the Proving myself game. It never pays out.'},{t:'Check the evidence: what you built, what you have fixed, who you have grown. Then do the next thing.',v:'best',n:'Feelings are not a balance sheet. The ledger is.'},{t:'Keep it to yourself.',v:'ok',n:'Understandable. The thought gets lighter once said to someone you trust.'}],
  coach:['You built a firm from nothing, eighteen years ago, and it is still here. That is not an opinion. It is the record.']},
 {id:'p-heavy3',k:'heavy',title:'Comparing',scene:'You see another founder’s success online and feel behind.',
  opts:[{t:'Set a bigger target to catch up.',v:'trap',n:'Their game, their score.'},{t:'Close it. Read the score you chose in Future. Measure against that only.',v:'best',n:'Your game, your rules.'},{t:'Message them to find out how they did it.',v:'ok',n:'Can be useful. Make sure it is curiosity, not comparison.'}],
  coach:['You are comparing your inside with their outside. Nobody posts their 3am.']},
 {id:'p-heavy4',k:'heavy',title:'Tired',scene:'You have slept badly three nights running and today is full.',
  opts:[{t:'More coffee and keep going.',v:'trap',n:'Borrowed energy, paid back with interest on Thursday.'},{t:'Move one big decision to tomorrow, do the small things today, and go to bed early.',v:'best',n:'You protected the asset the firm depends on most.'},{t:'Take the afternoon off.',v:'ok',n:'Good if the diary allows it. Moving the big decision matters more.'}],
  coach:['Tired judgement is the most expensive thing in the firm. Schedule the big calls for when you are rested.']}
];
/* ---------- Daily system calls: one a day, alternating operations and sales ----------
   Fresh content every day is the reason to come back tomorrow. Answering scores nothing, as everywhere
   in the ledger; the reward is mastery (every call made world-class) and the action it offers. A call not
   yet made world-class comes back round later, so the deck is finished by judgement, not by attendance. */
const SYSTEM=[
 {id:'s-ops1',theme:'ops',title:'Copied on everything',scene:'You were copied on 120 emails this week. Nine needed you.',
  opts:[{t:'Read them all. Better informed than surprised.',v:'trap',n:'You spent a day reading other people’s work.'},{t:'Tell the team: copy me only when I must decide or must know by Friday. Everything else, the client owner.',v:'best',n:'One rule, written once, removes most of the noise for good.'},{t:'Set up a filter and read the folder on Fridays.',v:'ok',n:'Tidier inbox, same cause.'}],
  coach:['Being copied is how people hand you their risk. Give the risk back with a rule, not a filter.'],
  todo:{text:'Send the copy rule: copy me only when I must decide or must know by Friday.',type:'Stop',h:'week',hours:3}},
 {id:'s-ops2',theme:'ops',title:'The approval queue',scene:'Six things are waiting for your sign-off: a refund, a supplier, two proposals, a rota and a software trial.',
  opts:[{t:'Clear them all tonight.',v:'trap',n:'The queue refills by Wednesday. You are the queue.'},{t:'Set limits: under a figure, the manager approves. Above it, you see a one-line recommendation.',v:'best',n:'Most of the queue now never reaches you.'},{t:'Approve the urgent ones and leave the rest.',v:'ok',n:'Triage, not a fix.'}],
  coach:['Every approval you hold is a decision someone else could make with a limit and a standard. Write the limits.'],
  todo:{text:'Write approval limits: what managers sign off without me, and the figure above which I see it.',type:'Start',h:'week',hours:3}},
 {id:'s-ops3',theme:'ops',title:'The process in your head',scene:'Month-end for your biggest client only runs smoothly when you check it. Nobody else knows your checks.',
  opts:[{t:'Keep checking it. It works.',v:'trap',n:'It works while you are there. That is the problem.'},{t:'Record yourself doing the check once. Turn it into a written checklist with an owner.',v:'best',n:'Your judgement is now the firm’s, not just yours.'},{t:'Ask the manager to shadow you next month.',v:'ok',n:'Good start. Shadowing fades; a checklist stays.'}],
  coach:['If a process lives only in your head, the firm rents it from you every month. Write it down and it becomes an asset.'],
  todo:{text:'Record my month-end check for our biggest client and turn it into a checklist with an owner.',type:'Start',h:'month',hours:2}},
 {id:'s-ops4',theme:'ops',title:'The Monday numbers',scene:'You have no single page that tells you, on Monday, whether the firm is on track.',
  opts:[{t:'You know roughly. You can feel it.',v:'trap',n:'Feel is how anxiety fills the gap where numbers should be.'},{t:'Five numbers on one page every Monday: fees billed, cash, work in progress, late jobs, new clients.',v:'best',n:'You sell this to clients. Now you have it too.'},{t:'Ask finance for a full monthly pack.',v:'ok',n:'More detail, a month too late.'}],
  coach:['Uncertainty feeds anxiety more than bad news does. Five numbers you trust replace a week of wondering.'],
  todo:{text:'Agree my five Monday numbers and who sends them by 9am every Monday.',type:'Start',h:'week',hours:1}},
 {id:'s-ops5',theme:'ops',title:'The late jobs',scene:'Four client packs went out late this month. Each had a different excuse.',
  opts:[{t:'Chase each one personally.',v:'trap',n:'Four fires, four times your time, cause untouched.'},{t:'Put every late job on one list with its cause. Fix the most common cause first.',v:'best',n:'Different excuses usually share one cause.'},{t:'Remind everyone deadlines matter.',v:'ok',n:'They know. The system is letting them down.'}],
  coach:['Late work is a system output. Look for the common cause: missing records, unclear owner, too much work per person.'],
  todo:{text:'Start a late-jobs list with causes, reviewed monthly. Fix the most common cause first.',type:'Start',h:'month',hours:2}},
 {id:'s-ops6',theme:'ops',title:'Capacity',scene:'The team says they are stretched. You are not sure if that is true or a feeling.',
  opts:[{t:'Hire someone now to be safe.',v:'ok',n:'Maybe right. Without the numbers you will not know.'},{t:'Measure hours by client and person for four weeks. Decide from the numbers.',v:'best',n:'Then the hire, or the repricing, is obvious.'},{t:'Tell them to push through busy season.',v:'trap',n:'Good people leave quietly in busy seasons.'}],
  coach:['Capacity is a number, not a mood. Measure it before you either hire or ignore it.'],
  todo:{text:'Track hours by client and person for four weeks, then decide on hiring or repricing.',type:'Start',h:'month',hours:1}},
 {id:'s-ops7',theme:'ops',title:'The new starter',scene:'A new starter begins Monday. Last time, onboarding was you answering questions for a month.',
  opts:[{t:'Do the same again. It worked.',v:'trap',n:'It cost you a month and taught them to come to you.'},{t:'A written first two weeks, a named buddy, and a check-in with you at day ten only.',v:'best',n:'They learn the system, not your diary.'},{t:'Let the team work it out.',v:'ok',n:'They will. Slowly, and differently each time.'}],
  coach:['Onboarding is the cheapest place to install your standards. Write it once and every hire after gets it.'],
  todo:{text:'Write the first two weeks for new starters, with a named buddy and one check-in with me.',type:'Start',h:'month',hours:3}},
 {id:'s-ops8',theme:'ops',title:'The second in command',scene:'If you were off for a month, nobody is clearly in charge.',
  opts:[{t:'It will be fine. You will not be off for a month.',v:'trap',n:'Illness and family do not ask first.'},{t:'Name a second in command for operations. Give them the decisions in writing and back them publicly.',v:'best',n:'The firm now has a spine that is not you.'},{t:'Share it across the managers.',v:'ok',n:'Shared ownership often means nobody owns it.'}],
  coach:['A firm with one person who can decide has one point of failure. Naming a second is the most valuable thing you will do this year.'],
  todo:{text:'Name a second in command for operations and write down the decisions that are now theirs.',type:'Start',h:'quarter',hours:5}},
 {id:'s-ops9',theme:'ops',title:'The software that nobody uses',scene:'You paid for a practice system a year ago. Half the team still uses spreadsheets.',
  opts:[{t:'Build your own tracker so you can see it all.',v:'trap',n:'Now there are three systems and you run one of them.'},{t:'Name an owner, set a date after which spreadsheets stop, and train to it.',v:'best',n:'A system only works when there is one.'},{t:'Ask nicely again.',v:'ok',n:'The habit is stronger than the request.'}],
  coach:['Tools do not change behaviour. Owners, dates and standards do.'],
  todo:{text:'Name an owner for the practice system and set the date spreadsheets stop.',type:'Start',h:'month',hours:2}},
 {id:'s-ops10',theme:'ops',title:'The weekly meeting that drifts',scene:'Your leadership meeting runs ninety minutes and mostly updates you.',
  opts:[{t:'Keep it. You need the updates.',v:'trap',n:'You are the audience, so they prepare for you, not for decisions.'},{t:'Forty-five minutes. Numbers first, then only decisions and blockers. Updates go in writing beforehand.',v:'best',n:'Half the time and twice the decisions.'},{t:'Cancel it.',v:'ok',n:'You lose the one forum for the leadership team.'}],
  coach:['A meeting where people report to you trains them to need you. A meeting where they decide trains them to lead.'],
  todo:{text:'Rewrite the leadership meeting: 45 minutes, numbers, decisions, blockers. Updates in writing first.',type:'Start',h:'week',hours:1}},
 {id:'s-ops11',theme:'ops',title:'The client who only calls you',scene:'A long-standing client rings your mobile with every question.',
  opts:[{t:'Answer. They have earned it.',v:'trap',n:'Every answer confirms you are their accountant, not the firm.'},{t:'Call them, introduce their owner, explain why it is better for them. Redirect kindly every time after.',v:'best',n:'They get faster answers and you get your evenings.'},{t:'Stop answering their calls.',v:'trap',n:'Avoidance without explanation damages the relationship.'}],
  coach:['Redirecting a client is a service decision, not a rejection. Explain the benefit to them, then hold the line.'],
  todo:{text:'Move the clients who ring my mobile to their named owner, with a call from me to explain.',type:'Stop',h:'month',hours:2}},
 {id:'s-ops12',theme:'ops',title:'The error that keeps coming back',scene:'The same VAT coding error has appeared in three client files this quarter.',
  opts:[{t:'Correct each one when you review.',v:'trap',n:'You have become the error check. That is not a system.'},{t:'Add it to the review checklist and make it a training point this week.',v:'best',n:'The fix now runs without you.'},{t:'Email the team about it.',v:'ok',n:'Read once and forgotten by Friday.'}],
  coach:['If your review is the only thing catching an error, the process is relying on your attention. Move the check into the process.'],
  todo:{text:'Add the recurring VAT coding error to the review checklist and train on it this week.',type:'Start',h:'week',hours:1}},
 {id:'s-sales1',theme:'sales',title:'Who is it for?',scene:'Last month you took a café, a 30-site group and a bakery. They need different things.',
  opts:[{t:'Good. Diversity spreads risk.',v:'trap',n:'It also spreads your team thin and your message thinner.'},{t:'Write the ideal client in five lines: type, size, what they value, and who you turn away.',v:'best',n:'Now the team can sell without you in the room.'},{t:'Focus only on large groups from now on.',v:'ok',n:'Clear, but decide it from your margin data, not a mood.'}],
  coach:['Sales systems start with a clear answer to who is it for. Without it, every enquiry needs the founder to decide.'],
  todo:{text:'Write the ideal client profile in five lines, including who we turn away.',type:'Start',h:'week',hours:1}},
 {id:'s-sales2',theme:'sales',title:'Every proposal is bespoke',scene:'Each proposal takes you two hours to write from scratch.',
  opts:[{t:'Keep writing them. Clients can tell.',v:'trap',n:'They can tell it is late, mostly.'},{t:'Build three packages and one proposal template. The team fills it in; you review only the big ones.',v:'best',n:'Proposals out in a day, not a week.'},{t:'Write shorter ones.',v:'ok',n:'Faster, still all you.'}],
  coach:['A proposal is a product page. Build it once, well, and let the team send it.'],
  todo:{text:'Build three packages and one proposal template the team can send without me.',type:'Start',h:'month',hours:4}},
 {id:'s-sales3',theme:'sales',title:'The pipeline in your head',scene:'Someone asks what is in the pipeline. You list it from memory.',
  opts:[{t:'It is fine. You know them all.',v:'trap',n:'Until you are off for a week and three go cold.'},{t:'One board: every lead, its stage, next step and owner. Reviewed for thirty minutes every Monday.',v:'best',n:'Now you can see sales without carrying them.'},{t:'Put them in a spreadsheet when you have time.',v:'ok',n:'You will not have time. Book it.'}],
  coach:['A pipeline you hold in your head becomes a worry you carry at 3am. A pipeline on a board becomes a meeting.'],
  todo:{text:'Set up one pipeline board with stage, next step and owner. Thirty-minute review every Monday.',type:'Start',h:'week',hours:2}},
 {id:'s-sales4',theme:'sales',title:'The referral you never asked for',scene:'Your happiest clients would recommend you. You have never asked them to.',
  opts:[{t:'Wait. Good work speaks for itself.',v:'trap',n:'It whispers. Asking makes it speak.'},{t:'Ask at the three-month review, every time, with one line. Track and thank every referral.',v:'best',n:'Referrals become a system, not luck.'},{t:'Offer a referral fee.',v:'ok',n:'Can work. Asking well works first.'}],
  coach:['Operators trust other operators. A referral from one is worth ten adverts. Build the ask into the client journey.'],
  todo:{text:'Add a referral ask to every three-month client review, and thank every referral personally.',type:'Start',h:'month',hours:1}},
 {id:'s-sales5',theme:'sales',title:'The discount request',scene:'A prospect says a competitor is 20 percent cheaper.',
  opts:[{t:'Match it. A client is a client.',v:'trap',n:'You have just bought a low-margin client who will leave for the next discount.'},{t:'Show what they get that the cheaper firm does not: the 3-day close, weekly numbers, hospitality people. Hold the price.',v:'best',n:'The right clients pay for value.'},{t:'Offer 10 percent off as a compromise.',v:'ok',n:'Half the damage, same lesson taught.'}],
  coach:['Price is a signal of confidence. Clients who buy only on price are clients you will lose on price.'],
  todo:{text:'Write a one-page value comparison the team uses when prospects quote a cheaper firm.',type:'Start',h:'month',hours:1}},
 {id:'s-sales6',theme:'sales',title:'Only you can close',scene:'Every prospect meeting needs you there, or it does not convert.',
  opts:[{t:'Keep doing them all. Sales is the founder’s job.',v:'trap',n:'Sales is the founder’s job until it is the firm’s ceiling.'},{t:'Take a manager to every meeting for a month. Then they lead and you join only the largest.',v:'best',n:'Your judgement transfers by watching.'},{t:'Hire a salesperson.',v:'ok',n:'Possibly right later. First make selling teachable.'}],
  coach:['If only you can close, the method lives in your head. Make it visible so someone else can learn it.'],
  todo:{text:'Take a manager to every prospect meeting this month, then hand over all but the largest.',type:'Start',h:'month',hours:3}},
 {id:'s-sales7',theme:'sales',title:'The slow follow-up',scene:'A promising lead from a trade event has not heard from you in two weeks.',
  opts:[{t:'Send a long email now explaining you have been busy.',v:'ok',n:'Better late than never, but busy is not a selling point.'},{t:'Rule: every lead gets a reply in one working day and a next step in the diary, owned by a named person.',v:'best',n:'Speed wins more work than brilliance.'},{t:'Leave it. If they were keen they would chase.',v:'trap',n:'Keen leads go to whoever replies first.'}],
  coach:['In service businesses the fastest credible reply wins most work. Make speed a rule, not a heroic effort.'],
  todo:{text:'Set the lead rule: reply within one working day, next step booked, named owner.',type:'Start',h:'week',hours:1}},
 {id:'s-sales8',theme:'sales',title:'Where clients come from',scene:'You do not know which of your last twenty clients came from referrals, events or the website.',
  opts:[{t:'It does not matter. They came.',v:'trap',n:'You cannot repeat what you cannot see.'},{t:'Ask and record the source for every new client from now on. Review it quarterly.',v:'best',n:'In six months you will know where to spend.'},{t:'Spend more on all of them.',v:'ok',n:'Expensive guessing.'}],
  coach:['You would never let a client spend on marketing without knowing what works. Hold the firm to the same standard.'],
  todo:{text:'Record the source of every new client and review the sources quarterly.',type:'Start',h:'week',hours:0}},
 {id:'s-sales9',theme:'sales',title:'The quiet pipeline',scene:'Two weeks with no new enquiries. Your stomach drops.',
  opts:[{t:'Start ringing everyone you know.',v:'ok',n:'Energy is good. Panic selling sounds like panic.'},{t:'Check the board: is it two weeks or a trend? Then pick one channel and act on it.',v:'best',n:'A system reading, not a feeling.'},{t:'Assume the firm is in trouble.',v:'trap',n:'Two weeks is noise. Your history says so.'}],
  coach:['A quiet fortnight is a variance. Read the trend before you let it read you.'],
  todo:{text:'Look at twelve months of enquiries by month so I know what a normal quiet spell looks like.',type:'Start',h:'week',hours:1}},
 {id:'s-sales10',theme:'sales',title:'The content you keep meaning to write',scene:'You have strong views on hospitality numbers. Nobody outside your clients ever reads them.',
  opts:[{t:'Write a long article when you find a free weekend.',v:'trap',n:'There is no free weekend. It never ships.'},{t:'One short post a fortnight from questions clients actually ask. The team drafts, you add the view.',v:'best',n:'Steady, real, and not reliant on your weekends.'},{t:'Hire an agency to write it.',v:'ok',n:'Polished, but it will not sound like you.'}],
  coach:['Operators buy from people who clearly understand their world. Your existing answers to clients are the content.'],
  todo:{text:'Start a fortnightly post from real client questions. Team drafts, I add the view.',type:'Start',h:'month',hours:1}},
 {id:'s-sales11',theme:'sales',title:'Losing a pitch',scene:'You lost a pitch you expected to win.',
  opts:[{t:'Decide the market has changed.',v:'trap',n:'One loss is a data point.'},{t:'Ask the prospect for ten honest minutes on why. Add what you learn to the template.',v:'best',n:'Every loss improves the system.'},{t:'Lower prices for the next one.',v:'ok',n:'Maybe price was not the reason. Find out first.'}],
  coach:['Win and loss reasons are the cheapest sales research there is. Collect them every time.'],
  todo:{text:'Ask for feedback on every lost pitch and add one learning to the template each time.',type:'Start',h:'month',hours:0}},
 {id:'s-sales12',theme:'sales',title:'Upselling existing clients',scene:'Half your clients only use bookkeeping. They have never been offered weekly dashboards.',
  opts:[{t:'Do not push. They are happy.',v:'trap',n:'Happy and underserved. A competitor will offer it.'},{t:'At each review, show one number they could see weekly and what it would have saved them.',v:'best',n:'Value shown, not sold.'},{t:'Email everyone about the new service.',v:'ok',n:'Fine for awareness. Conversations convert.'}],
  coach:['Existing clients already trust you. Growing them is cheaper and calmer than chasing new ones.'],
  todo:{text:'At every client review this quarter, show one weekly number and what it would have saved.',type:'Start',h:'quarter',hours:1}}
];
/* ---------- Phone-off day ---------- */
const OFF={
  decider:['My managing director','My finance lead','Each client’s owner','The leadership team'],
  route:['call my second in command, who can reach me','ring my mobile twice in a row and I will answer','message my partner, who will pass it on'],
  threshold:['a client about to leave','a regulatory deadline that cannot move','staff safety','cash that cannot wait'],
  items:['A client question','A team question','An approval','A sales enquiry','An invoice or payment','A complaint','A deadline','Something I would normally check']
};
const OFF_PTS=25;
/* ---------- Fear and reality, in the Friday review ---------- */
const FEARS=['Losing a big client','Cash running short','A key person leaving','A mistake reaching a client','Sales drying up','Letting the team down','Not being good enough','Nothing this week'];
const OUTCOMES=[{k:'never',name:'It never happened'},{k:'better',name:'Better than I feared'},{k:'same',name:'About as I feared'},{k:'worse',name:'Worse than I feared'}];
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
const blank=()=>({v:2,baseline:null,baselineTs:0,todos:[],reviews:[],notes:[],answers:{},calls:[],pendingCall:false,wildMonth:null,wildLog:[],future:blankFuture(),letterQ:{answers:{},step:0},letterDraft:'',letterReads:[],letterCoach:null,practiceRuns:[],resets:[],offDays:[],sysLog:[],deck:{drawn:[],redraws:2},view:'today',callId:null,updatedAt:0});

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
const fmtDay=ts=>new Date(ts).toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'});
const dayKey=ts=>{const d=new Date(ts);return d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate();};
const RESET_PTS=5;
const isResetMove=t=>!!(t.source&&t.source.startsWith('reset-'));
const ptsFor=t=>isResetMove(t)?RESET_PTS:(PTS[t.type]||10)+(t.source&&t.source.startsWith('w')?20:0);
const allCalls=()=>FOUNDING.concat(S.calls);
const findCall=id=>allCalls().find(c=>c.id===id)||BANK.find(c=>c.id===id);

/* ---------- Derived numbers. Nothing here is stored, so nothing can drift. ---------- */
function streakAt(i){let n=1;for(let j=i;j>0;j--){if(S.reviews[j].ts-S.reviews[j-1].ts<=10*DAY)n++;else break;}return n;}
function streak(){if(!S.reviews.length)return 0;const last=S.reviews[S.reviews.length-1];if(Date.now()-last.ts>10*DAY)return 0;return streakAt(S.reviews.length-1);}
function points(){
  let p=0;
  const resetDays={};
  S.todos.forEach(t=>{if(!t.done)return;
    if(isResetMove(t)){const k=dayKey(t.doneAt||0);resetDays[k]=(resetDays[k]||0)+1;if(resetDays[k]<=3)p+=RESET_PTS;return;}
    p+=PTS[t.type]||10;if(t.source&&t.source.startsWith('w'))p+=20;});
  S.reviews.forEach((r,i)=>{p+=15+Math.min(5*(streakAt(i)-1),25);});
  const perWeek={};S.notes.forEach(n=>{const w=weekNo(n.ts);perWeek[w]=(perWeek[w]||0)+1;});
  Object.values(perWeek).forEach(c=>p+=3*Math.min(c,3));
  const offWeeks=new Set();(S.offDays||[]).forEach(o=>{if(o.status==='back'&&!offWeeks.has(weekNo(o.day))){offWeeks.add(weekNo(o.day));p+=OFF_PTS;}});
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

/* ---------- The Reset: derived numbers ---------- */
function resetsToday(now=Date.now()){const k=dayKey(now);return (S.resets||[]).filter(r=>dayKey(r.ts)===k).length;}
const plural=(n,w)=>`${n} ${w}${n===1?'':'s'}`;
/* Facts from the player's own ledger, never a slogan. Each one can be traced to something they did. */
function receipts(){
  const out=[];
  const done=S.todos.filter(t=>t.done);
  const real=done.filter(t=>!isResetMove(t));
  if(real.length)out.push(`You have finished ${plural(real.length,'action')} on this ledger. Each one is a decision you made and carried through.`);
  const stops=real.filter(t=>t.type==='Stop').length;
  if(stops)out.push(`${stops} of them ${stops===1?'was a Stop':'were Stops'}: things you took off your own plate for good. That is the hardest kind of action, and you have done it.`);
  const bb=boughtBack();
  if(bb.perWeek>0)out.push(`You have bought back ${bb.perWeek.toFixed(1)} hours a week, and banked ${bb.total.toFixed(1)} hours so far. Those hours exist because you decided they would.`);
  if(S.reviews.length){const st=streak();out.push(`You have closed ${plural(S.reviews.length,'week')} on this ledger.${st>1?` The streak is at ${st} weeks.`:''} Founders who close their own week are running the firm, not being run by it.`);}
  const goods=S.notes.filter(n=>n.kind==='good');
  if(goods.length){const g=goods[goods.length-1];out.push(`On ${fmtDate(g.ts)} you logged: "${g.text}". That did not happen by accident. Something you built made it happen.`);}
  if(goods.length>=3)out.push(`You have logged ${plural(goods.length,'good thing')}. Most founders cannot name three from last month.`);
  const without=goods.filter(n=>/without me|good call/i.test(n.text)).length;
  if(without)out.push(`${without===1?'Once':without+' times'} so far, someone solved it or made the call without you. That is the firm you are building, already working.`);
  const moved=done.filter(isResetMove).length;
  if(moved)out.push(`${moved===1?'Once':moved+' times'} you have turned a heavy moment into a move and done it. That is control: not of the outcome, of the next step.`);
  const ot=offTotals();
  if(ot.days)out.push(`On ${plural(ot.days,'phone-off day')}, ${ot.waited} thing${ot.waited===1?'':'s'} waited fine and ${ot.handled} ${ot.handled===1?'was':'were'} handled without you. The firm held.`);
  const fg=fearGap();
  if(fg.logged)out.push(`Of ${plural(fg.logged,'fear')} you named on a Friday, ${fg.better} turned out better than feared or never happened.`);
  const sm=sysMastered().size;
  if(sm)out.push(`You have made ${plural(sm,'world-class system call')}. That is judgement about building the firm, not just running it.`);
  if(wc(S.future.letter)>=150)out.push('You have written down the life you are building. Most founders never get that far.');
  const runs=S.practiceRuns||[];const best=Math.max(practice().judgement,...runs.map(r=>r.judgement));
  if(best>=70)out.push(`Your best practice judgement score is ${best} out of 100. You know what good looks like under pressure.`);
  const l=latest();
  if(S.baseline&&l&&l!==S.baseline){METERS.forEach(m=>{const d=(Number(l[m.k])-Number(S.baseline[m.k]))*10;if(d>0)out.push(`Your ${m.name.toLowerCase()} line is up ${d} points on your opening position.`);});}
  return out;
}
const RECEIPT_EMPTY='This ledger is new, so the receipts are still to come. Here is the first: you stopped and chose your next move instead of reacting. That is the job.';
function receiptFor(n){const r=receipts();return r.length?r[n%r.length]:RECEIPT_EMPTY;}
/* What was loud this week, for the Friday review. */
function loudWeek(now=Date.now()){
  const rs=(S.resets||[]).filter(r=>now-r.ts<7*DAY&&r.ts<=now);
  const by={};LOUD.forEach(x=>by[x.k]={n:0,days:new Set()});
  rs.forEach(r=>{if(by[r.loud]){by[r.loud].n++;by[r.loud].days.add(dayKey(r.ts));}});
  const sorts={decide:0,influence:0,not:0};rs.forEach(r=>{if(sorts[r.sort]!=null)sorts[r.sort]++;});
  const moves=rs.map(r=>S.todos.find(t=>t.id===r.todo)).filter(Boolean);
  const perDay={};rs.forEach(r=>{const k=dayKey(r.ts);perDay[k]=(perDay[k]||0)+1;});
  const signals=LOUD.filter(x=>by[x.k].days.size>=3).map(x=>({k:x.k,name:x.name,days:by[x.k].days.size}));
  return {count:rs.length,by:LOUD.map(x=>({k:x.k,name:x.name,n:by[x.k].n,days:by[x.k].days.size})).filter(x=>x.n),sorts,
    moves:moves.length,movesDone:moves.filter(t=>t.done).length,capDays:Object.values(perDay).filter(n=>n>=RESET_CAP).length,signals};
}
/* Logs a finished reset and puts its move on the list (or points at an action already there). */
function finishReset(r){
  const ts=r.ts||Date.now();
  let todo=r.todoId?S.todos.find(t=>t.id===r.todoId):null;
  if(!todo)todo=addTodo({text:r.move,type:'Start',h:'week',hours:0,source:'reset-'+ts,createdAt:ts});
  const entry={ts,loud:r.loud,sort:r.sort,receipt:r.receipt||'',move:todo.text,todo:todo.id,call:null};
  S.resets=(S.resets||[]).concat(entry);if(S.resets.length>600)S.resets=S.resets.slice(-600);
  return entry;
}
function pressureFor(loud){
  const recent=new Set((S.resets||[]).slice(-12).map(r=>r.call&&r.call.id).filter(Boolean));
  const mine=PRESSURE.filter(c=>c.k===loud);const fresh=mine.filter(c=>!recent.has(c.id));
  const pool=fresh.length?fresh:(mine.length?mine:PRESSURE);
  return pool[(S.resets||[]).length%pool.length];
}

/* ---------- Daily system calls: derived ---------- */
const dayNum=ts=>{const d=new Date(ts);return Math.floor(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())/DAY);};
function sysMastered(){const m=new Set();(S.sysLog||[]).forEach(l=>{const c=SYSTEM.find(x=>x.id===l.id);if(c&&c.opts[l.pick]&&c.opts[l.pick].v==='best')m.add(l.id);});return m;}
/* Today's call: the one already played today, or the next in rotation. Themes alternate by day; a call
   not yet made world-class comes round again after the unplayed ones. */
function sysToday(now=Date.now()){
  const k=dayKey(now);const done=(S.sysLog||[]).find(l=>dayKey(l.ts)===k);
  if(done)return {call:SYSTEM.find(x=>x.id===done.id),played:done};
  const m=sysMastered();const seen=new Set((S.sysLog||[]).map(l=>l.id));
  const want=dayNum(now)%2?'sales':'ops';
  const pick=theme=>{const pool=SYSTEM.filter(c=>c.theme===theme&&!m.has(c.id));return pool.find(c=>!seen.has(c.id))||pool[0]||null;};
  const call=pick(want)||pick(want==='ops'?'sales':'ops');
  return {call,played:null};
}
function sysRhythm(now=Date.now()){const days=new Set((S.sysLog||[]).filter(l=>now-l.ts<7*DAY&&l.ts<=now).map(l=>dayKey(l.ts)));return days.size;}
function playSys(id,pick,ts=Date.now()){
  const k=dayKey(ts);if((S.sysLog||[]).some(l=>dayKey(l.ts)===k))return false;
  S.sysLog=(S.sysLog||[]).concat({id,pick,ts});return true;
}
function sysProgress(){const m=sysMastered();return ['ops','sales'].map(t=>({theme:t,name:t==='ops'?'Operations':'Sales',done:SYSTEM.filter(c=>c.theme===t&&m.has(c.id)).length,total:SYSTEM.filter(c=>c.theme===t).length}));}
/* ---------- Phone-off day: derived ---------- */
function offCurrent(){return (S.offDays||[]).find(o=>o.status==='planned')||null;}
function offTotals(){
  const back=(S.offDays||[]).filter(o=>o.status==='back');
  const sum=k=>back.reduce((a,o)=>a+((o.log&&o.log[k])||[]).length,0);
  return {days:back.length,waited:sum('waited'),handled:sum('handled'),broke:sum('broke')};
}
function offRecent(now=Date.now(),weeks=8){return new Set((S.offDays||[]).filter(o=>o.status==='back'&&now-o.day<weeks*7*DAY&&o.day<=now+DAY).map(o=>weekNo(o.day))).size;}
function planOff(o){
  const id='o'+uid();const day=o.day;
  const plan={id,day,decider:o.decider||'',route:o.route||'',threshold:o.threshold||[],status:'planned',log:null,plannedAt:o.ts||Date.now()};
  S.offDays=(S.offDays||[]).filter(x=>x.status!=='planned').concat(plan);
  addTodo({text:`Send the phone-off brief for ${fmtDay(day)} to the team`,type:'Start',h:'week',hours:0,source:'off-brief-'+id});
  return plan;
}
function logOff(log,day=Date.now()){
  let o=offCurrent();
  if(!o){o={id:'o'+uid(),day,decider:'',route:'',threshold:[],status:'planned',log:null,plannedAt:day};S.offDays=(S.offDays||[]).concat(o);}
  o.status='back';o.loggedAt=Date.now();
  o.log={waited:[].concat(log.waited||[]),handled:[].concat(log.handled||[]),broke:[].concat(log.broke||[])};
  o.log.handled.forEach(t=>S.notes.push({ts:o.loggedAt,kind:'good',text:'Handled without me: '+t}));
  o.log.broke.forEach((t,i)=>addTodo({text:`Design out: ${t} (stalled on my phone-off day)`,type:'Start',h:'month',hours:1,source:`off-fix-${o.id}-${i}`}));
  const brief=S.todos.find(t=>t.source==='off-brief-'+o.id);if(brief&&!brief.done){brief.done=true;brief.doneAt=o.loggedAt;}
  return o;
}
function offBrief(o){
  const th=(o.threshold||[]).length?(o.threshold.length>1?o.threshold.slice(0,-1).join(', ')+' or '+o.threshold[o.threshold.length-1]:o.threshold[0]):'something that truly cannot wait';
  const next=fmtDay(o.day+DAY);
  return `I am off my phone on ${fmtDay(o.day)}. ${o.decider||'The leadership team'} decides anything that would normally come to me. If it is ${th}, ${o.route||'call my second in command, who can reach me'}. Everything else waits until ${next}, and that is fine. Thank you for running it.`;
}
/* ---------- Fear and reality: derived ---------- */
function fearGap(){
  const rs=S.reviews.filter(r=>r.fear&&r.fear!=='Nothing this week'&&r.fearOutcome);
  const better=rs.filter(r=>r.fearOutcome==='never'||r.fearOutcome==='better').length;
  return {logged:rs.length,better,worse:rs.filter(r=>r.fearOutcome==='worse').length};
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
  const sysWaiting=sysToday().call&&!sysToday().played;
  const oc=offCurrent();const offDue=oc&&dayKey(oc.day)!==dayKey(Date.now())&&oc.day<Date.now();
  const tabs=[['today','Today',sysWaiting?'1':''],['reset','Reset',''],['off','Phone off',offDue?'due':''],['review','Friday review',reviewDue()?'due':''],['actions','Actions',open?String(open):''],['calls','Play',unplayed?String(unplayed):''],['future','Future','']];
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
  ${vResetCard()}
  ${vSysCard()}
  ${vMomentum()}
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
/* ---------- Reset ---------- */
let RD=null; // the reset in progress; not saved until it ends in a move
function vResetCard(){
  const n=resetsToday();
  return `<div class="card reset-card"><div class="spread"><div><div class="eyebrow">Reset &middot; three minutes</div><h3>Loud day? Name it, sort it, pick one move.</h3></div><button class="btn small" data-tab="reset">Reset</button></div><p class="small muted">${n?`${plural(n,'reset')} today. `:''}It ends in one move under fifteen minutes, then you go and do it.</p></div>`;
}
function vReset(){
  const n=resetsToday();
  const steps=['loud','sort','receipt','move'];
  const head=(i,t)=>`<div class="eyebrow">Reset &middot; ${i} of 4</div><h2>${t}</h2>`;
  const last=(S.resets||[]).slice().reverse().find(r=>{const t=S.todos.find(x=>x.id===r.todo);return t&&!t.done;});
  const lastT=last&&S.todos.find(x=>x.id===last.todo);
  if(!RD){
    if(n>=RESET_CAP){
      const lw=loudWeek();
      return `<section><div class="card"><div class="eyebrow">Reset &middot; ${plural(n,'reset')} today</div><h2>Six resets today. The pattern is the data.</h2>
       <p>Today the loud thing has been ${esc(LOUD.filter(x=>(S.resets||[]).some(r=>dayKey(r.ts)===dayKey(Date.now())&&r.loud===x.k)).map(x=>x.name.toLowerCase()).join(', ')||'mixed')}. ${lw.movesDone?`You have done ${lw.movesDone} of this week’s ${lw.moves} moves.`:''}</p>
       <p class="muted">Another reset will not change what the last six have told you. Step away from the screen for twenty minutes: walk, eat, or talk to someone. Friday’s review will read the pattern properly. If days like this keep coming, say it out loud to someone you trust, not just to this ledger.</p>
       ${lastT?`<div class="added">Your open move: ${esc(lastT.text)} <button class="btn small" data-act="resetDone" data-id="${lastT.id}" style="margin-left:6px">Done it</button></div>`:''}
       <div class="row"><button class="btn small ghost" data-act="resetStart">Reset anyway</button></div></div></section>`;
    }
    RD={step:'loud'};
  }
  let body='';
  if(RD.step==='loud')body=`<div class="card">${head(1,'What is loud right now?')}
    <p class="muted">One tap. Naming it is the first thing that makes it smaller.</p>
    ${chipRow('rs-loud',LOUD.map(x=>x.name),{act:'reset-loud'})}
    ${lastT?`<div class="added">Still open from an earlier reset: ${esc(lastT.text)} <button class="btn small ghost" data-act="resetDone" data-id="${lastT.id}" style="margin-left:6px">Done it</button></div>`:''}
    ${n>=RESET_CAP-1?`<p class="small muted">This is reset ${n+1} today. Six is the most the ledger offers before it asks you to step away.</p>`:''}</div>`;
  else if(RD.step==='sort'){const L=LOUD.find(x=>x.k===RD.loud);body=`<div class="card">${head(2,'Whose is it?')}
    <p class="muted">${esc(L.name)}. Be honest about which of these it is. This is the one skill the whole reset is built on.</p>
    ${chipRow('rs-sort',SORT.map(x=>x.name),{act:'reset-sort'})}
    <div class="row"><button class="btn small ghost" data-act="resetBack">Back</button></div></div>`;}
  else if(RD.step==='receipt'){const so=SORT.find(x=>x.k===RD.sort);body=`<div class="card">${head(3,'The receipts')}
    <div class="coach"><p>${esc(so.coach)}</p></div>
    <div class="receipt"><div class="eyebrow">From your ledger</div><p>${esc(RD.receipt)}</p></div>
    <p class="small muted">Enough is not a feeling you wait for. It is a balance you can trace, and this is one line of it. You do not control how this turns out. You are in charge of the next move, and that part was always yours.</p>
    <div class="row"><button class="btn" data-act="resetNext">Pick the move</button><button class="btn small ghost" data-act="resetBack">Back</button></div></div>`;}
  else if(RD.step==='move'){
    const moves=MOVES[RD.sort==='not'?'not':RD.loud]||MOVES.heavy;
    const open=S.todos.filter(t=>!t.done&&!isResetMove(t)).sort((a,b)=>(b.star?1:0)-(a.star?1:0)).slice(0,3);
    body=`<div class="card">${head(4,'One move, under fifteen minutes')}
    <p class="muted">Small enough to start now. It goes on your list and scores when you tick it.</p>
    ${chipRow('rs-move',moves,{act:'reset-move',other:true})}
    <div class="row"><button class="btn small ghost" data-act="resetOwn">Use my own words</button></div>
    ${open.length?`<div class="lbl small">Or one already on your list</div><div class="chips-row">${open.map(t=>`<button type="button" class="pick" data-act="resetTodo" data-id="${t.id}">${esc(t.text)}</button>`).join('')}</div>`:''}
    <div class="row"><button class="btn small ghost" data-act="resetBack">Back</button></div></div>`;}
  else if(RD.step==='done'){const e=RD.entry;body=`<div class="card">
    <div class="eyebrow">Reset done</div><h2>Go and do it.</h2>
    <div class="big3"><div class="eyebrow">Your move</div><p>${esc(e.move)}</p></div>
    <p class="muted">Close this and start. The ledger will be here. Tick it in Actions or on the next reset when it is done.</p>
    <div class="row"><button class="btn" data-act="resetDone" data-id="${e.todo}">Done it already</button><button class="btn small ghost" data-act="resetCall">One pressure call first</button></div></div>`;}
  else if(RD.step==='call'){const c=PRESSURE.find(x=>x.id===RD.call);const a=RD.pick;
    body=`<div class="card"><div class="eyebrow">Pressure call &middot; ${esc(c.title)}</div><div class="scene">${esc(c.scene)}</div>
    <div class="opts">${c.opts.map((o,i)=>`<button class="opt ${a===i?'picked':a!=null?'dim':''}" data-act="resetPick" data-i="${i}"><span class="k">${'ABC'[i]}</span><span>${esc(o.t)}</span></button>`).join('')}</div>
    ${a!=null?(()=>{const o=c.opts[a];const best=c.opts.find(x=>x.v==='best');return `<div class="row"><span class="verdict v-${o.v}">${{best:'World-class call',ok:'Workable',trap:'The trap'}[o.v]}</span></div><p>${esc(o.n)}</p>
     <div class="coach"><div class="eyebrow">The coaching</div>${c.coach.map(p=>`<p>${esc(p)}</p>`).join('')}${o.v!=='best'?`<p class="muted">The world-class call: ${esc(best.t)}</p>`:''}</div>
     <div class="big3"><div class="eyebrow">Now your move</div><p>${esc(RD.entry.move)}</p></div>
     <div class="row"><button class="btn" data-tab="today">Close and go</button></div>`;})():''}</div>`;}
  const dots=RD.step==='done'||RD.step==='call'?'':`<div class="dots">${steps.map((s,i)=>`<span class="dot ${steps.indexOf(RD.step)>i?'done':''} ${RD.step===s?'cur':''}">${i+1}</span>`).join('')}</div>`;
  return `<section>${dots}${body}</section>`;
}
/* ---------- Daily system call ---------- */
function vSysCall(t,inPlay){
  const {call,played}=t;
  if(!call)return `<div class="card"><div class="eyebrow">System builder</div><h3>Every system call made world-class.</h3><p class="muted">The deck is finished. The system is now yours to run, not to carry.</p></div>`;
  const a=played?played.pick:null;const tomorrow=dayNum(Date.now()+DAY)%2?'sales':'operations';
  const themeName=call.theme==='ops'?'Operations':'Sales';
  let out=`<div class="card sys-card"><div class="spread"><div class="eyebrow">Today’s system call &middot; ${themeName}</div><span class="small muted">${sysRhythm()} of the last 7 days</span></div>
   <h3>${esc(call.title)}</h3><div class="scene">${esc(call.scene)}</div>
   <div class="opts">${call.opts.map((o,i)=>`<button class="opt ${a===i?'picked':a!=null?'dim':''}" data-act="sysPick" data-id="${call.id}" data-i="${i}"><span class="k">${'ABC'[i]}</span><span>${esc(o.t)}</span></button>`).join('')}</div>`;
  if(a!=null){
    const o=call.opts[a];const best=call.opts.find(x=>x.v==='best');const added=S.todos.some(x=>x.source==='sys-'+call.id);
    out+=`<div class="row"><span class="verdict v-${o.v}">${{best:'World-class call',ok:'Workable',trap:'The trap'}[o.v]}</span></div><p>${esc(o.n)}</p>
     <div class="coach"><div class="eyebrow">The coaching</div>${call.coach.map(p=>`<p>${esc(p)}</p>`).join('')}${o.v!=='best'?`<p class="muted">The world-class call: ${esc(best.t)} This one comes back round, so you can make it world-class next time.</p>`:''}</div>
     <div class="added">The system move: ${esc(call.todo.text)} ${added?'<span class="small muted">On your list.</span>':`<button class="btn small" data-act="sysAdd" data-id="${call.id}" style="margin-left:6px">Add to actions</button>`}</div>
     <p class="small muted">One call a day. Tomorrow: ${tomorrow}.</p>`;
  }
  return out+'</div>';
}
function vSysCard(){return vSysCall(sysToday());}
function vSysPanel(){
  const pr=sysProgress();const m=sysMastered();
  return `<div class="card"><div class="eyebrow">System builder</div><h3>Build the firm that runs without you</h3>
   <p class="small muted">One operations or sales call a day on Today. A call becomes yours when you make the world-class call. Those you miss come back round.</p>
   ${pr.map(x=>`<div class="meter"><span class="name">${x.name}</span><div class="bar"><i style="width:${Math.round(100*x.done/x.total)}%"></i></div><span class="val">${x.done}/${x.total}</span></div>`).join('')}
   <div class="sys-list">${SYSTEM.map(c=>`<span class="sys-chip ${m.has(c.id)?'won':(S.sysLog||[]).some(l=>l.id===c.id)?'tried':''}" title="${esc(c.title)}">${esc(c.title)}</span>`).join('')}</div></div>`;
}
/* ---------- Momentum: this week at a glance ---------- */
function vMomentum(){
  const lw=loudWeek();const ot=offTotals();const fg=fearGap();const pr=sysProgress();
  const mastered=pr.reduce((a,x)=>a+x.done,0),total=pr.reduce((a,x)=>a+x.total,0);
  const oc=offCurrent();const recent=offRecent();
  const cell=(lab,fig,sub)=>`<div class="mo"><span class="lab">${lab}</span><span class="fig">${fig}</span><span class="sub">${sub}</span></div>`;
  return `<div class="card"><div class="eyebrow">Your momentum</div><div class="mo-grid">
   ${cell('System calls',`${sysRhythm()}/7`,`days this week &middot; ${mastered} of ${total} mastered`)}
   ${cell('Phone-off days',`${recent}/8`,oc?`next: ${esc(fmtDay(oc.day))}`:'weeks with one. <button class="linkish" data-tab="off">Plan the next</button>')}
   ${cell('Fear vs reality',fg.logged?`${fg.better}/${fg.logged}`:'&ndash;',fg.logged?'fears that turned out better or never happened':'named in the Friday review')}
   ${cell('Reset moves',`${lw.movesDone}/${lw.moves}`,lw.moves?'done this week':'none needed this week')}
  </div>${ot.days?`<p class="small muted">Across your phone-off days: ${ot.waited} waited fine, ${ot.handled} handled without you, ${ot.broke} stalled and became ${ot.broke===1?'a fix':'fixes'}.</p>`:''}</div>`;
}
/* ---------- Phone-off day ---------- */
let OFFLOG=false;
function vOff(){
  const o=offCurrent();const ot=offTotals();const now=Date.now();
  const days=[...Array(7)].map((_,i)=>new Date(new Date(now+(i+1)*DAY).setHours(12,0,0,0)).getTime());
  let body='';
  if(o&&(OFFLOG||dayKey(o.day)!==dayKey(now)&&o.day<now))body=vOffLog(o);
  else if(o&&!OFFLOG){
    const today=dayKey(o.day)===dayKey(now);
    body=`<div class="card call-to"><div class="eyebrow">Phone-off day${today?' &middot; today':''}</div><h2>${today?'Today is the day. Phone in a drawer.':esc(fmtDay(o.day))}</h2>
     <p class="muted">${today?'No checking. One check is the same as not taking the day. Log it when you are back.':'Send the brief below the day before. Then trust it.'}</p>
     <div class="brief" id="offBrief">${esc(offBrief(o))}</div>
     <div class="row"><button class="btn small" data-act="copyBrief">Copy the brief</button>${today?'<button class="btn small ghost" data-act="offLogOpen">I am back: log it</button>':''}<button class="btn small ghost" data-act="offCancel">Cancel</button></div></div>`;
  }else if(OFFLOG)body=vOffLog(null);
  else body=`<div class="card"><div class="eyebrow">Phone-off day</div><h2>A day the firm runs without you.</h2>
    <p class="muted">Not rest that costs the firm. A stress test that shows exactly what to build next. Plan it, brief it, take it, then log what happened.</p>
    <div class="field"><span class="lbl">Which day?</span><div class="chips-row" data-group="off-day" data-multi="0">${days.map(d=>`<button type="button" class="pick" data-pick-group="off-day" data-val="${d}">${esc(new Date(d).toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'}))}</button>`).join('')}</div></div>
    <div class="field"><span class="lbl">Who decides while you are off?</span>${chipRow('off-decider',OFF.decider,{other:true})}</div>
    <div class="field"><span class="lbl">The one emergency route</span><span class="hint">If it truly cannot wait, they will...</span>${chipRow('off-route',OFF.route,{other:true})}</div>
    <div class="field"><span class="lbl">What counts as an emergency?</span><span class="hint">Tap all that apply. Everything else waits.</span>${chipRow('off-threshold',OFF.threshold,{multi:true})}</div>
    <div class="row"><button class="btn" data-act="offPlan">Plan it</button><button class="btn small ghost" data-act="offLogOpen">Already had one? Log it</button></div></div>`;
  const past=(S.offDays||[]).filter(x=>x.status==='back').slice().reverse();
  const hist=past.length?`<div class="card"><div class="spread"><h3>Your phone-off days</h3><span class="small muted">${offRecent()} of the last 8 weeks</span></div>
   <p class="small">${ot.waited} waited fine &middot; ${ot.handled} handled without you &middot; ${ot.broke} stalled and became ${ot.broke===1?'a fix':'fixes'}</p>
   <div class="tbl-wrap"><table><thead><tr><th>Day</th><th class="num">Waited</th><th class="num">Handled</th><th class="num">Stalled</th></tr></thead><tbody>
   ${past.map(x=>`<tr><td>${esc(fmtDate(x.day))}</td><td class="num delta-up">${x.log.waited.length}</td><td class="num delta-up">${x.log.handled.length}</td><td class="num ${x.log.broke.length?'delta-down':''}">${x.log.broke.length}</td></tr>`).join('')}
   </tbody></table></div><p class="small muted">The waited column is your evidence. It is almost always longer than your anxiety predicted.</p></div>`:'';
  return `<section>${body}${hist}</section>`;
}
function vOffLog(o){
  return `<div class="card"><div class="eyebrow">Back from your phone-off day</div><h2>What came up, and what happened to it?</h2>
   <p class="muted">Twenty minutes, first thing back. Tap what came up in each column. This is your bottleneck map.</p>
   <div class="field"><span class="lbl">Waited fine</span><span class="hint">It could wait, and it did. This is your evidence.</span>${chipRow('ol-waited',OFF.items,{multi:true,other:true})}</div>
   <div class="field"><span class="lbl">Someone handled it</span><span class="hint">Thank them. It goes in your notice log.</span>${chipRow('ol-handled',OFF.items,{multi:true,other:true})}</div>
   <div class="field"><span class="lbl">Stalled or broke</span><span class="hint">Each one becomes a system fix on your list.</span>${chipRow('ol-broke',OFF.items,{multi:true,other:true})}</div>
   <div class="row"><button class="btn" data-act="offLog">Log the day</button><button class="btn small ghost" data-act="offLogClose">Not now</button></div></div>`;
}
function vLoudWeek(){
  const lw=loudWeek();if(!lw.count)return '';
  return `<div class="card"><div class="eyebrow">What was loud this week</div><h3>${plural(lw.count,'reset')}, ${lw.movesDone} of ${plural(lw.moves,'move')} done</h3>
   <ul class="checks">${lw.by.map(x=>`<li class="loud"><span>${esc(x.name)}</span><span class="prog">${plural(x.n,'time')} on ${plural(x.days,'day')}</span></li>`).join('')}</ul>
   <p class="small muted">Sorted as yours to decide ${lw.sorts.decide}, to influence ${lw.sorts.influence}, not yours ${lw.sorts.not}.${lw.sorts.not>lw.count/2?' More than half of it was not yours to carry. Notice that.':''}</p>
   ${lw.signals.map(x=>{const fx=FIX[x.k];const has=S.todos.some(t=>t.source&&t.source.startsWith('fix-'+x.k+'-')&&!t.done);return `<div class="coach"><p>${esc(x.name)} was loud on ${x.days} days this week. That is not a mood. It is a signal with a system behind it.</p><p>${esc(fx.text)}</p>${has?'<p class="small muted">Already on your list.</p>':`<div><button class="btn small" data-act="addFix" data-k="${x.k}">Add it to actions</button></div>`}</div>`;}).join('')}
   ${lw.capDays?`<p class="small">You reached ${RESET_CAP} resets on ${plural(lw.capDays,'day')} this week. That is worth saying out loud to someone you trust, not just to this ledger.</p>`:''}</div>`;
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
   <p class="muted">${sameWeek?'You logged a review on '+fmtDate(S.reviews[S.reviews.length-1].ts)+'. Logging again replaces it.':'All taps, no typing. Same six steps every week.'}</p></div>
  ${vLoudWeek()}

  <div class="card"><div class="eyebrow">1. What you did</div><h3>Tick what got done</h3>
   ${open.length?open.map(t=>`<label class="item" style="cursor:pointer"><input type="checkbox" data-done="${t.id}"><span class="txt"><span>${esc(t.text)}</span><span class="meta"><span class="pill ${t.type}">${t.type}</span><span class="pill">+${ptsFor(t)} pts</span>${t.hours?`<span class="pill">${t.hours} hrs/wk back</span>`:''}</span></span><span></span></label>`).join(''):'<p class="empty">Nothing open for this week. Add actions in Actions.</p>'}
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

  <div class="card"><div class="eyebrow">5. Fear and reality</div><h3>What did you fear this week, and what actually happened?</h3>
   <p class="small muted">Anxiety predicts. This keeps the score on its predictions. ${(()=>{const fg=fearGap();return fg.logged?`So far ${fg.better} of ${fg.logged} turned out better than feared or never happened.`:'';})()}</p>
   ${chipRow('rv-fear',FEARS,{other:true})}
   <div class="field"><span class="lbl">What actually happened?</span>${chipRow('rv-outcome',OUTCOMES.map(x=>x.name))}</div></div>

  <div class="card"><div class="eyebrow">6. Next week</div>
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
  const src=t.source?(t.source.startsWith('w')?'Wildcard':t.source.startsWith('audit')?'Opening':t.source.startsWith('review')?'Review':t.source.startsWith('reset-')?'Reset':t.source.startsWith('fix-')?'Pattern':'Call'):'';
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
   ${vSysPanel()}
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
  const rt=byId('resetTop');if(rt)rt.hidden=S.view==='reset';
  const v={today:vToday,reset:vReset,off:vOff,review:vReview,actions:vActions,calls:vCalls,future:vFuture}[S.view]||vToday;
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
  S.calls.push(call);S.pendingCall=false;S.view='calls';S.callId=call.id;save();render();toTop();
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

/* The Reset sits below the scoreboard, so on a phone "top" means its own steps, not the page. */
function toTop(){if(S.view==='reset'||S.view==='off'){const t=byId('tabs');if(t&&t.scrollIntoView){t.scrollIntoView({block:'start'});return;}}window.scrollTo({top:0});}
function endReset(o){
  if(!RD||!RD.loud||!RD.sort)return;
  const entry=finishReset({loud:RD.loud,sort:RD.sort,receipt:RD.receipt,move:o.move,todoId:o.todoId});
  RD={step:'done',entry};save();render();toTop();
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
    if(S.view==='review'){renderBoard();setStatus(t.done?`+${ptsFor(t)} points`:'Unticked');}else render();}
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
      case 'reset-loud':{const L=LOUD.find(x=>x.name===v);if(!L)break;RD={step:'sort',loud:L.k};render();toTop();break;}
      case 'reset-sort':{const so=SORT.find(x=>x.name===v);if(!so||!RD)break;RD.sort=so.k;RD.receipt=receiptFor((S.resets||[]).length);RD.step='receipt';render();toTop();break;}
      case 'reset-move':endReset({move:v});break;
      case 'pillar':{const k=d.pickGroup.slice(3);S.future.pillars[k].ten=v;save();const i=byId('pt-'+k);if(i)i.value=v;break;}
    }
    return;
  }
  if(d.tab){if(d.tab==='reset'&&RD&&(RD.step==='done'||RD.step==='call'))RD=null;if(d.tab!=='off')OFFLOG=false;S.view=d.tab;save();render();toTop();return;}
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
      {const fear=picked('rv-fear')[0]||'';const oc=OUTCOMES.find(x=>x.name===picked('rv-outcome')[0]);if(fear){r.fear=fear;if(oc&&fear!=='Nothing this week')r.fearOutcome=oc.k;}}
      METERS.forEach(m=>r[m.k]=Number($('#rv-'+m.k).value));
      const before=points();
      if(S.reviews.length&&r.ts-S.reviews[S.reviews.length-1].ts<4*DAY)S.reviews[S.reviews.length-1]=r;else{S.reviews.push(r);S.pendingCall=true;}
      r.good.forEach(g=>S.notes.push({ts:r.ts,kind:'good',text:g}));
      if(r.space)S.notes.push({ts:r.ts,kind:'space',text:r.space});
      if(r.change)addTodo({text:r.change,type:'Start',h:'week',hours:0,source:'review-'+r.ts});
      if(r.inSystem)addTodo({text:'Design out: '+r.inSystem,type:'Stop',h:'month',hours:1,source:'review-sys-'+r.ts});
      reviewGame='';S.view='today';save();render();toTop();
      const gained=points()-before;
      $('#view').insertAdjacentHTML('afterbegin',`<div class="toast"><strong>Week closed. +${gained} points, streak ${streak()} week${streak()===1?'':'s'}.</strong><span class="small">${S.pendingCall?'Your next call is ready to deal below.':'Review updated.'}</span></div>`);
      break;}
    case 'dealCall':dealCall(b);break;
    case 'sysPick':{const c=SYSTEM.find(x=>x.id===d.id);if(!c)return;if(playSys(c.id,Number(d.i))){save();render();const o=c.opts[Number(d.i)];setStatus(o.v==='best'?'World-class. That one is yours.':'Noted. It comes back round.');}break;}
    case 'sysAdd':{const c=SYSTEM.find(x=>x.id===d.id);if(!c)return;addTodo({text:c.todo.text,type:c.todo.type,h:c.todo.h,hours:c.todo.hours||0,source:'sys-'+c.id});save();render();setStatus('On your list. It scores when it is done.');break;}
    case 'offPlan':{
      const day=Number(picked('off-day')[0]);if(!day){setStatus('Pick the day first.');return;}
      planOff({day,decider:picked('off-decider')[0]||'',route:picked('off-route')[0]||'',threshold:picked('off-threshold')});
      save();render();toTop();setStatus('Planned. The brief is on your list for the day before.');break;}
    case 'offLogOpen':OFFLOG=true;render();toTop();break;
    case 'offLogClose':OFFLOG=false;render();toTop();break;
    case 'offCancel':S.offDays=(S.offDays||[]).filter(x=>x.status!=='planned');save();render();break;
    case 'offLog':{
      const log={waited:picked('ol-waited'),handled:picked('ol-handled'),broke:picked('ol-broke')};
      if(!log.waited.length&&!log.handled.length&&!log.broke.length){setStatus('Tap at least one thing that came up. If nothing did, tap Waited fine.');return;}
      const before=points();logOff(log);OFFLOG=false;save();S.view='off';render();toTop();
      const g=points()-before;
      $('#view').insertAdjacentHTML('afterbegin',`<div class="toast"><strong>Phone-off day logged.${g?` +${g} points.`:''}</strong><span class="small">${log.waited.length} waited fine, ${log.handled.length} handled without you${log.broke.length?`, ${log.broke.length} now on your list as ${log.broke.length===1?'a fix':'fixes'}`:''}. That is your bottleneck map.</span></div>`);
      break;}
    case 'copyBrief':{const o=offCurrent();if(!o)return;const txt=offBrief(o);
      try{await navigator.clipboard.writeText(txt);setStatus('Brief copied. Send it the day before.');}catch(err){const el=byId('offBrief');if(el){const r=document.createRange();r.selectNodeContents(el);const sel=window.getSelection();sel.removeAllRanges();sel.addRange(r);}setStatus('Brief selected. Copy it from the box.');}
      break;}
    case 'resetStart':RD={step:'loud'};render();break;
    case 'resetBack':{const order=['loud','sort','receipt','move'];const i=order.indexOf(RD&&RD.step);if(i>0)RD.step=order[i-1];render();break;}
    case 'resetNext':if(RD)RD.step='move';render();toTop();break;
    case 'resetOwn':{const t=(byId('other-rs-move')||{}).value;const txt=(t||'').trim();if(!txt){const o=byId('other-rs-move');if(o){o.hidden=false;o.focus();}setStatus('Write the move in a few words, then tap Use my own words.');return;}endReset({move:txt});break;}
    case 'resetTodo':endReset({todoId:d.id});break;
    case 'resetDone':{const t=S.todos.find(x=>x.id===d.id);if(!t)return;const before=points();if(!t.done){t.done=true;t.doneAt=Date.now();t.star=false;}
      if(RD&&RD.step!=='loud')RD=null;save();S.view='today';render();toTop();
      $('#view').insertAdjacentHTML('afterbegin',`<div class="toast"><strong>Done. That is the move made.</strong><span class="small">${points()>before?'+'+(points()-before)+' points. ':''}You were in charge of the next step, and you took it.</span></div>`);break;}
    case 'resetCall':{if(!RD||!RD.entry)return;const c=pressureFor(RD.entry.loud);RD.step='call';RD.call=c.id;RD.pick=null;render();toTop();break;}
    case 'resetPick':{if(!RD||RD.pick!=null)return;RD.pick=Number(d.i);const e=S.resets.find(r=>r.ts===RD.entry.ts);if(e){e.call={id:RD.call,pick:RD.pick};save();}render();break;}
    case 'addFix':{const fx=FIX[d.k];if(!fx)return;addTodo(Object.assign({},fx,{source:'fix-'+d.k+'-'+weekNo(Date.now())}));save();render();setStatus('On your list. That is the system fix, not the symptom.');break;}
    case 'nextCall':{const i=FOUNDING.findIndex(c=>c.id===S.callId);const nx=FOUNDING.slice(i+1).find(c=>S.answers[c.id]==null)||FOUNDING.find(c=>S.answers[c.id]==null);S.callId=nx?nx.id:'results';save();render();toTop();break;}
    case 'replay':{const pr=practice();S.practiceRuns=(S.practiceRuns||[]).concat({ts:Date.now(),judgement:pr.judgement,best:pr.best.length,traps:pr.traps.length,index:pr.index});FOUNDING.forEach(c=>delete S.answers[c.id]);S.callId=FOUNDING[0].id;S.deck={drawn:[],redraws:2};save();render();toTop();break;}
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
  migrate, points, streak, boughtBack, receipts, receiptFor, resetsToday, loudWeek, finishReset, pressureFor,
  RESET_CAP, RESET_PTS, LOUD, SORT, MOVES, FIX, PRESSURE,
  sysToday, sysRhythm, sysMastered, sysProgress, playSys, offCurrent, offTotals, offRecent, planOff, logOff, offBrief, fearGap,
  SYSTEM, OFF, OFF_PTS, FEARS, OUTCOMES, levels, practice, letterChecks, ceoIndex, reviewDue, addTodo, deltaFor,
  FOUNDING, BANK, WILD, LETTER_Q, GAMES, PTS, PICK, LETTER_PICKS,
  mount() {
    ROOT.innerHTML = MARKUP;
    attach();
    render();
    return () => { offs.splice(0).forEach(f => f()); ROOT.innerHTML = ''; };
  },
};
}
