<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>WEKS Tap-To-Math</title>
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <style>
    :root { color-scheme: light dark; }
    body { font-family: Arial, sans-serif; background:#111; color:#fff; margin:0; padding:24px; text-align:center; }
    h1 { margin: 0 0 8px; display:flex; align-items:center; gap:10px; justify-content:center; }
    .logo { width:28px; height:28px; border-radius:6px; background:#ffd54a; display:inline-block; }
    .sub { opacity:.85; margin-bottom:20px; }
    .card { margin:0 auto; max-width:420px; background:#1c1c1c; padding:20px; border-radius:14px; box-shadow:0 6px 22px rgba(0,0,0,.5); }
    .q { font-size:34px; margin:18px 0; }
    .grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
    button { padding:14px 10px; border:0; border-radius:12px; font-size:18px; cursor:pointer; background:#ffd54a; color:#111; }
    button:active { transform: translateY(1px); }
    .meta { margin:14px 0 4px; font-size:14px; opacity:.85; }
    .ok { color:#6ee78c; }
    .bad { color:#ff7a7a; }
    .muted { opacity:.7; }
  </style>
</head>
<body>
  <h1><span class="logo"></span> WEKS <b>Tap-To-Math</b></h1>
  <div class="sub">Solve, stack correct answers, then <b>Claim</b> to get coins.</div>

  <div class="card">
    <div id="status" class="meta">Correct: <span id="c">0</span> • Wrong: <span id="w">0</span></div>
    <div id="q" class="q">Loading…</div>
    <div class="grid" id="answers"></div>
    <div class="meta muted">Daily cap: 100 Q → +10 coins each</div>
    <div id="flash" class="meta"></div>
  </div>

  <script>
    const tg = window.Telegram.WebApp;
    tg.ready();
    tg.expand();
    tg.MainButton.setText("CLAIM & CLOSE");
    tg.MainButton.show();

    let correct = 0, wrong = 0, current = null;

    function randint(a,b){ return Math.floor(Math.random()*(b-a+1))+a; }

    function newQuestion(){
      const ops = ["+","-","×","÷"];
      const op = ops[randint(0,ops.length-1)];
      let a = randint(2,25), b = randint(2,25), ans=0;

      if(op==="+"){ ans = a+b; }
      else if(op==="-"){ if(b>a){ [a,b]=[b,a]; } ans=a-b; }
      else if(op==="×"){ ans=a*b; }
      else if(op==="÷"){
        ans = randint(2,12);
        b = randint(2,12);
        a = ans*b; // divisible
      }

      current = { text: `${a} ${op} ${b} = ?`, ans };
      document.getElementById("q").textContent = current.text;

      const opts = new Set([ans]);
      while(opts.size<4){
        const delta = randint(1,10);
        const sign = Math.random()<0.5?-1:1;
        opts.add(ans + sign*delta);
      }
      const shuffled = Array.from(opts).sort(()=>Math.random()-0.5);

      const box = document.getElementById("answers");
      box.innerHTML = "";
      shuffled.forEach(v=>{
        const btn = document.createElement("button");
        btn.textContent = v;
        btn.onclick = ()=>choose(v);
        box.appendChild(btn);
      });
      flash("");
    }

    function flash(text, good){
      const f = document.getElementById("flash");
      f.textContent = text;
      f.className = "meta " + (good===true?"ok":good===false?"bad":"");
    }

    function choose(v){
      if(!current) return;
      if(Number(v)===current.ans){
        correct++; flash("Correct! Ready to claim later ✅", true);
        tg.HapticFeedback.notificationOccurred("success");
      } else {
        wrong++; flash(`Oops! Correct was ${current.ans}`, false);
        tg.HapticFeedback.notificationOccurred("error");
      }
      document.getElementById("c").textContent = correct;
      document.getElementById("w").textContent = wrong;
      newQuestion();
    }

    tg.MainButton.onClick(async ()=>{
      const payload = JSON.stringify({ t:"claim", correct });

      try {
        // Ask once per user; Telegram remembers this grant
        const granted = await tg.requestWriteAccess();
        if (!granted) {
          tg.showAlert("Please allow write access so we can credit your coins.");
          return;
        }
        tg.sendData(payload);  // delivers web_app_data to your bot
        tg.close();            // close after sending
      } catch (e) {
        console.error(e);
        tg.showAlert("Could not send claim. Try again.");
      }
    });

    newQuestion();
  </script>
</body>
</html>
