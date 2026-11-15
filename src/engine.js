/* ---------- Lexicon ---------- */
function parseLex(s){const o={};s.trim().split(/\s+/).forEach(p=>{const i=p.lastIndexOf(':');o[p.slice(0,i)]=parseFloat(p.slice(i+1));});return o;}
const LEX=parseLex(`
love:3.2 loved:2.9 loves:2.7 loving:2.6 lovely:2.8 like:1.2 liked:1.8 likes:1.4 great:3.1 good:1.9 nice:1.8 awesome:3.1 amazing:2.8 excellent:3.2
fantastic:2.6 wonderful:2.7 best:3.2 better:1.9 perfect:2.7 perfectly:2.6 happy:2.7 glad:2.0 beautiful:2.9 brilliant:2.8 cool:1.3 fun:2.3 enjoy:2.2
enjoyed:2.3 enjoying:2.2 recommend:1.5 recommended:1.5 worth:0.9 impressive:2.2 impressed:2.1 solid:1.6 smooth:1.3 fast:1.0 easy:1.6 helpful:1.8
friendly:2.2 thanks:1.9 thank:1.5 thx:1.6 ty:1.4 grateful:2.0 excited:2.2 exciting:2.2 incredible:2.6 outstanding:3.0 superb:3.1 pleased:1.9 satisfied:1.8
reliable:1.7 comfortable:1.6 comfy:1.6 clean:1.0 gorgeous:3.0 stunning:2.8 favorite:2.0 favourite:2.0 fav:2.0 fave:2.0 win:2.8 wins:2.7 won:2.7 winning:2.4
success:2.7 yay:2.4 wow:2.8 delightful:2.8 delighted:2.8 flawless:2.6 quick:1.0 affordable:1.4 legit:1.5 dope:2.0 lit:2.0 fire:1.6 goat:2.5 slay:2.2
slays:2.2 slaps:2.2 bussin:2.2 based:1.3 lol:1.0 lmao:1.2 haha:1.8 hahaha:2.0 masterpiece:3.0 epic:2.3 wholesome:2.3 obsessed:1.8 kudos:2.0 bravo:2.2
congrats:2.4 congratulations:2.6 hope:1.9 hopeful:1.8 proud:2.1 safe:1.2 trust:2.0 fair:1.3 fixed:1.0 works:1.0 improved:1.9 improvement:1.8 joy:2.8
laugh:2.0 smile:1.6 cute:2.0 sweet:2.0 pleasant:2.3 fresh:1.3 strong:1.3 powerful:1.4 efficient:1.5 intuitive:1.8 seamless:2.0 usable:1.0 ok:0.9 okay:0.9
fine:0.8 decent:1.2 adore:2.9 blessed:2.6 thrilled:2.9 genius:2.4 crisp:1.3 elite:1.8 top-notch:2.6 gem:2.2 bargain:1.6 helped:1.6 helps:1.4 fun:2.3 gift:1.5
hate:-2.7 hated:-3.2 hates:-1.9 bad:-2.5 worse:-2.1 worst:-3.1 terrible:-2.5 awful:-2.0 horrible:-2.5 poor:-2.1 disappointed:-1.9 disappointing:-2.2
disappointment:-2.3 sad:-2.1 angry:-2.3 annoying:-1.9 annoyed:-1.6 broken:-2.0 broke:-1.8 useless:-1.8 waste:-1.8 wasted:-2.2 slow:-1.0 crash:-1.7
crashes:-1.7 crashed:-1.8 crashing:-1.7 bug:-1.0 buggy:-1.8 bugs:-1.0 laggy:-1.6 lag:-1.2 fail:-2.5 failed:-2.3 fails:-2.0 failure:-2.3 problem:-1.7
problems:-1.7 issue:-1.0 issues:-1.0 error:-1.4 errors:-1.4 refund:-1.0 scam:-2.8 fraud:-2.8 ripoff:-2.6 overpriced:-1.8 expensive:-0.9 ugly:-2.3 boring:-1.3
mediocre:-1.4 meh:-0.9 mid:-1.2 trash:-2.0 garbage:-2.3 sucks:-1.5 suck:-1.5 sucked:-2.0 rude:-2.0 unhelpful:-1.8 frustrating:-2.1 frustrated:-2.4
frustration:-2.1 confusing:-1.3 confused:-1.3 complicated:-0.9 difficult:-1.5 worried:-1.2 worry:-1.9 scared:-1.9 afraid:-2.0 fear:-2.2 unfortunately:-1.5
cancel:-1.0 cancelled:-1.0 canceled:-1.0 regret:-2.1 pathetic:-2.6 ridiculous:-1.5 disgusting:-2.4 gross:-2.1 nightmare:-2.5 unacceptable:-2.0 lame:-1.7
cringe:-1.6 sus:-1.0 yikes:-1.2 smh:-1.3 ugh:-1.8 wtf:-2.8 ick:-1.6 flop:-1.5 noisy:-1.2 uncomfortable:-1.6 hurt:-2.4 hurts:-2.1 pain:-2.3 painful:-2.5
late:-0.6 delay:-1.3 delayed:-1.2 missing:-1.2 lost:-1.3 wrong:-2.1 fake:-2.1 lie:-1.6 lies:-1.8 lied:-1.6 misleading:-1.7 spam:-1.5 toxic:-2.4
hostile:-2.0 horrendous:-3.0 dreadful:-2.7 atrocious:-3.1 lousy:-2.5 dumb:-2.3 stupid:-2.4 mad:-2.0 furious:-2.7 upset:-1.6 unhappy:-1.8 depressed:-2.3
depressing:-1.6 cry:-2.1 crying:-2.1 tired:-1.9 dislike:-1.6 avoid:-1.2 beware:-1.6 drains:-0.8 overheats:-1.6 overheating:-1.6 worthless:-1.9
outage:-1.6 glitch:-1.3 glitchy:-1.5 hassle:-1.7 inconvenient:-1.5 unreliable:-1.9 disconnecting:-1.2 disconnects:-1.2 unusable:-2.0 rip:-1.2
annoy:-1.5 horrid:-2.5 shame:-2.1 shameful:-2.4 nervous:-1.2 anxious:-1.3 joke:-1.0 sadly:-1.6 miss:-1.0 hopeless:-2.0 problematic:-1.6 cheap:-0.4
`);
// Single-letter slang only counts when written as a capital ("W", "L").
const CAPS_ONLY={w:1.5,l:-1.5};
const EMOJI={"😍":3,"🥰":3,"❤":2.8,"💕":2.5,"💖":2.5,"💚":2.4,"💙":2.4,"💜":2.4,"🧡":2.4,"💛":2.4,"😊":2.3,"🙂":1.4,"😀":2.2,"😃":2.2,"😄":2.4,"😁":2.2,
"😂":1.6,"🤣":1.8,"👍":1.8,"👏":2.0,"🙌":2.3,"🔥":1.8,"💯":2.0,"✨":1.4,"🎉":2.4,"🥳":2.6,"😎":1.8,"🤩":2.8,"💪":1.6,"✅":1.2,"⭐":1.5,"🌟":1.8,"🙏":1.3,"😇":2.0,"🤗":2.2,"😌":1.2,
"😢":-2.0,"😭":-1.2,"😡":-2.8,"😠":-2.4,"🤬":-3.0,"👎":-2.0,"😞":-2.0,"😔":-1.8,"😒":-1.6,"🙄":-1.5,"😤":-1.5,"😩":-1.6,"😫":-1.7,"🤮":-2.6,"🤢":-2.2,"💔":-2.5,
"😬":-1.0,"😕":-1.2,"🙃":-0.4,"😐":-0.3,"😑":-0.6,"🤡":-1.6,"🗑":-1.8,"❌":-1.2,"⚠":-0.8,"😖":-1.8,"😣":-1.6,"😟":-1.4,"😥":-1.5,"🤦":-1.5,"😓":-1.3};
const EMOTICON={":)":2,"=)":2,":D":2.4,"=D":2.4,";)":1.6,":(":-2,"=(":-2,":/":-1,":\\":-1,":P":1.2,":p":1.2,":*":1.6,"<3":2.6,":|":-0.4};
const BOOST={very:.293,really:.293,so:.293,extremely:.35,super:.293,totally:.293,absolutely:.35,incredibly:.35,too:.2,hella:.293,mega:.293,ultra:.293,
truly:.293,highly:.293,especially:.2,most:.2,deeply:.293,seriously:.293,literally:.15,insanely:.35,crazy:.25,soo:.35,sooo:.35,pretty:.15,quite:.15,
kinda:-.293,somewhat:-.293,slightly:-.293,barely:-.293,fairly:-.15,bit:-.2,little:-.2,marginally:-.293,sorta:-.293,partly:-.2};
const NEG=new Set("not no never none nobody nothing neither nor nowhere cannot cant dont doesnt didnt isnt arent wasnt werent wont wouldnt shouldnt couldnt aint hardly without lack lacks lacking havent hasnt".split(" "));
const EMOTIONS={
  Joy:"love loved loves lovely happy glad joy yay excited exciting delighted thrilled fun enjoy enjoyed enjoying blessed haha hahaha lol lmao laugh smile wholesome adore obsessed 😍 🥰 😊 😄 😂 🤣 🥳 🎉 ❤ 💕 😀 😃 😁 🤩 🤗",
  Trust:"reliable trust recommend recommended safe solid legit helpful helped friendly fair dependable thanks thank grateful 👍 🙏 ✅ 💯",
  Anger:"hate hated hates angry furious mad rude wtf ridiculous unacceptable scam fraud ripoff pathetic toxic hostile annoying annoyed frustrated frustrating 😡 🤬 😠 😤",
  Sadness:"sad disappointed disappointing disappointment cry crying depressed depressing regret unfortunately sadly miss hopeless unhappy hurt rip 😢 😞 😔 💔 😭 😥",
  Fear:"scared afraid fear worried worry beware nervous anxious risky dangerous 😬 😟 😨 😰",
  Surprise:"wow omg unexpected shocked surprised surprising whoa unbelievable 🤯 😮 😲 😱",
  Disgust:"disgusting gross trash garbage ick cringe nasty 🤮 🤢 🗑 🤡"
};
const EMO_INDEX={};Object.entries(EMOTIONS).forEach(([k,v])=>v.split(" ").forEach(w=>{(EMO_INDEX[w]=EMO_INDEX[w]||[]).push(k);}));

/* ---------- Tokenizer ---------- */
const TOKEN_RE=/(https?:\/\/\S+|www\.\S+)|(\p{Extended_Pictographic}️?(?:‍\p{Extended_Pictographic}️?)*)|(<3|[:;=]-?[)(DPp\/\\|*](?![\w\/]))|(#[\p{L}\p{N}_]+)|(@[\p{L}\p{N}_.]+)|(\/s\b)|([\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*)|([.!?,;]+)/gu;
function squeezeVariants(w){if(!/(.)\1\1/.test(w))return null;return [w.replace(/(.)\1{2,}/g,"$1$1"),w.replace(/(.)\1{2,}/g,"$1")];}
function tokenize(text){
  const out=[];let m;TOKEN_RE.lastIndex=0;
  while((m=TOKEN_RE.exec(text))){
    const t=m[0];let kind;
    if(m[1])kind="url";else if(m[2])kind="emoji";else if(m[3])kind="emo";else if(m[4])kind="tag";else if(m[5])kind="mention";else if(m[6])kind="sarc";else if(m[7])kind="word";else kind="p";
    const norm=kind==="word"||kind==="tag"?(kind==="tag"?t.slice(1):t).toLowerCase().replace(/’/g,"'"):t;
    out.push({t,kind,norm,start:m.index,end:m.index+t.length});
  }
  return out;
}
function isCapsWord(tk){return tk.kind==="word"&&tk.t.length>1&&/\p{Lu}/u.test(tk.t)&&tk.t===tk.t.toUpperCase();}
function isNeg(tk){if(tk.kind!=="word")return false;const n=tk.norm.replace(/'/g,"");return NEG.has(n)||/n't$/.test(tk.norm);}
function boostOf(tk){if(tk.kind!=="word")return null;if(BOOST[tk.norm]!=null)return BOOST[tk.norm];const sq=squeezeVariants(tk.norm);if(sq)for(const s of sq)if(BOOST[s]!=null)return BOOST[s];return null;}
function lookup(tk){
  if(tk.kind==="emoji"){const base=tk.t.replace(/️/g,"").split("‍")[0];if(EMOJI[base]!=null)return{v:EMOJI[base],key:base};return null;}
  if(tk.kind==="emo"){const k=tk.t.replace("-","");if(EMOTICON[k]!=null)return{v:EMOTICON[k],key:k};return null;}
  if(tk.kind!=="word"&&tk.kind!=="tag")return null;
  const w=tk.norm;
  if(w.length===1){if(CAPS_ONLY[w]!=null&&tk.t===tk.t.toUpperCase()&&tk.kind==="word")return{v:CAPS_ONLY[w],key:tk.t};return null;}
  if(LEX[w]!=null)return{v:LEX[w],key:w};
  const sq=squeezeVariants(w);
  if(sq)for(const s of sq)if(LEX[s]!=null)return{v:LEX[s],key:s,elong:true};
  return null;
}

/* ---------- Analyzer ---------- */
function analyze(text){
  text=text||"";
  const toks=tokenize(text);
  const words=toks.filter(t=>t.kind==="word"&&t.t.length>1&&/\p{L}/u.test(t.t));
  const capsCount=words.filter(isCapsWord).length;
  const capsDiff=capsCount>0&&capsCount<words.length;
  const items=[];const mods=new Set();
  toks.forEach((tk,i)=>{
    if(boostOf(tk)!=null)return; // boosters are modifiers, not scored words
    const hit=lookup(tk);if(!hit)return;
    let v=hit.v;const sign=Math.sign(hit.v);const notes=[];
    if(isCapsWord(tk)&&capsDiff){v+=sign*0.733;notes.push("ALL CAPS");}
    if(hit.elong){v+=sign*0.3;notes.push("stretched spelling");}
    let negTok=null;
    for(let j=i-1,d=0;j>=0&&d<3;j--){
      const pt=toks[j];
      if(pt.kind==="p"){if(/[.!?;]/.test(pt.t))break;continue;}
      if(pt.kind==="url"||pt.kind==="mention")continue;
      d++;
      const b=boostOf(pt);
      if(b!=null){const decay=[1,.95,.9][d-1];v+=sign*b*decay*(isCapsWord(pt)&&capsDiff?1.5:1);notes.push((b>0?"boosted by “":"softened by “")+pt.t+"”");mods.add(j);}
      if(isNeg(pt)&&!negTok&&tk.kind!=="emoji"&&tk.kind!=="emo"){negTok=pt;mods.add(j);}
    }
    if(negTok&&tk.kind!=="emoji"&&tk.kind!=="emo"){v*=-0.74;notes.push("flipped by “"+negTok.t+"”");}
    items.push({i,v,base:hit.v,key:hit.key,notes,tok:tk,negated:!!negTok});
  });
  // contrast: "but" / "however"
  let bi=-1;toks.forEach((t,i)=>{if(t.kind==="word"&&(t.norm==="but"||t.norm==="however"))bi=i;});
  if(bi>=0){mods.add(bi);items.forEach(it=>{if(it.i<bi){it.v*=0.5;it.notes.push("before “"+toks[bi].t+"” ×0.5");}else{it.v*=1.5;it.notes.push("after “"+toks[bi].t+"” ×1.5");}});}
  let sum=items.reduce((a,b)=>a+b.v,0);
  const excl=Math.min(4,(text.match(/!/g)||[]).length);
  const q=(text.match(/\?/g)||[]).length;
  const punct=excl*0.292+(q>1?Math.min(q,3)*0.18:0);
  if(sum>0)sum+=punct;else if(sum<0)sum-=punct;
  let compound=sum/Math.sqrt(sum*sum+15);
  compound=Math.max(-1,Math.min(1,compound));
  // proportions
  let ps=0,ns=0;items.forEach(it=>{if(it.v>0)ps+=it.v+1;else if(it.v<0)ns+=it.v-1;});
  const scoredIdx=new Set(items.map(it=>it.i));
  const neuCount=toks.filter((t,i)=>(t.kind==="word"||t.kind==="tag")&&!scoredIdx.has(i)).length;
  const tot=ps+Math.abs(ns)+neuCount||1;
  const label=compound>=0.05?"pos":compound<=-0.05?"neg":"neu";
  // emotions
  const emo={};
  toks.forEach((tk,i)=>{
    let key=tk.kind==="emoji"?tk.t.replace(/️/g,"").split("‍")[0]:(tk.kind==="word"||tk.kind==="tag")?tk.norm:null;
    if(!key)return;
    let cats=EMO_INDEX[key];
    if(!cats){const sq=squeezeVariants(key);if(sq)for(const s of sq)if(EMO_INDEX[s]){cats=EMO_INDEX[s];break;}}
    if(!cats)return;
    const it=items.find(x=>x.i===i);
    if(it&&it.negated)return;
    cats.forEach(c=>emo[c]=(emo[c]||0)+1);
  });
  const topEmo=Object.entries(emo).sort((a,b)=>b[1]-a[1])[0];
  // flags
  const flags=[];
  const lower=text.toLowerCase();
  const posSum=items.filter(x=>x.v>0).reduce((a,b)=>a+b.v,0);
  const negSum=items.filter(x=>x.v<0).reduce((a,b)=>a+b.v,0);
  const ironic=/[🙄🙃😒]/u.test(text);
  if(toks.some(t=>t.kind==="sarc")||/\byeah,? right\b|\bthanks a lot\b|\bjust great\b|\bwhat a surprise\b|\bsure,? jan\b/.test(lower)||(ironic&&posSum>0)||(/["“][^"”]{2,30}["”]/.test(text)&&ironic))flags.push("Possible sarcasm");
  if(posSum>=1.2&&negSum<=-1.2)flags.push("Mixed");
  if(!items.length&&words.length>0)flags.push("No sentiment words");
  return{text,toks,items,mods,compound,label,emo,topEmo:topEmo?topEmo[0]:"",flags,
    share:{pos:ps/tot,neg:Math.abs(ns)/tot,neu:neuCount/tot}};
}

/* ---------- Helpers ---------- */
const $=id=>document.getElementById(id);
const esc=s=>s.replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const LABEL={pos:"Positive",neg:"Negative",neu:"Neutral"};
const fmt=n=>(n>0?"+":n<0?"−":"")+Math.abs(n).toFixed(2);
function highlight(r){
  const byIdx={};r.items.forEach(it=>byIdx[it.i]=it);
  let html="",pos=0;
  r.toks.forEach((tk,i)=>{
    html+=esc(r.text.slice(pos,tk.start));
    const it=byIdx[i];
    if(it){const cls=it.v>0?"p":it.v<0?"n":"";html+=`<mark class="${cls}" title="${esc(fmt(it.v))}${it.notes.length?" · "+esc(it.notes.join(", ")):""}">${esc(tk.t)}</mark>`;}
    else if(r.mods.has(i))html+=`<mark class="m">${esc(tk.t)}</mark>`;
    else html+=esc(tk.t);
    pos=tk.end;
  });
  return html+esc(r.text.slice(pos));
}

