require("dotenv").config();
const express=require("express"), helmet=require("helmet"), cors=require("cors"), rateLimit=require("express-rate-limit");
const bcrypt=require("bcryptjs"), jwt=require("jsonwebtoken"), {z}=require("zod");
const db=require("./db"), auth=require("./auth");
const app=express();
app.set('trust proxy', 1);
if(!process.env.JWT_SECRET||process.env.JWT_SECRET.length<32) throw new Error("Set JWT_SECRET to a random secret of at least 32 characters.");
app.use(helmet());
app.use(cors({origin:(process.env.FRONTEND_ORIGIN||"http://localhost:8888").split(","),methods:["GET","POST","PATCH","DELETE"],allowedHeaders:["Content-Type","Authorization"]}));
app.use(express.json({limit:"20kb"}));
app.use(rateLimit({windowMs:60_000,limit:120,standardHeaders:true,legacyHeaders:false}));
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
app.get("/api/health",(req,res)=>res.json({ok:true,service:"ChoozaCoinX API",environment:process.env.NODE_ENV||"development",mode:"account-and-wallet-request-intake-only"}));
app.post("/api/auth/register",wrap(async(req,res)=>{
 const data=z.object({email:z.string().email().max(254),password:z.string().min(12).max(128)}).parse(req.body);
 const hash=await bcrypt.hash(data.password,12);
 try{const r=await db.query("INSERT INTO users(email,password_hash) VALUES($1,$2) RETURNING id,email,status",[data.email.toLowerCase(),hash]);
 const user=r.rows[0];const token=jwt.sign({sub:user.id,email:user.email},process.env.JWT_SECRET,{expiresIn:"2h"});
 res.status(201).json({user,token,note:"Account is pending compliance review. Trading is disabled until approved."});}
 catch(e){if(e.code==="23505")return res.status(409).json({error:"Email already registered"});throw e;}
}));
app.post("/api/auth/login",wrap(async(req,res)=>{
 const data=z.object({email:z.string().email(),password:z.string().min(1)}).parse(req.body);
 const r=await db.query("SELECT id,email,password_hash,status FROM users WHERE email=$1",[data.email.toLowerCase()]);
 if(!r.rowCount||!(await bcrypt.compare(data.password,r.rows[0].password_hash)))return res.status(401).json({error:"Invalid credentials"});
 const u=r.rows[0],token=jwt.sign({sub:u.id,email:u.email},process.env.JWT_SECRET,{expiresIn:"2h"});
 res.json({user:{id:u.id,email:u.email,status:u.status},token});
}));
app.get("/api/account",auth,wrap(async(req,res)=>{
 const r=await db.query("SELECT asset,available,locked FROM accounts WHERE user_id=$1 ORDER BY asset",[req.user.sub]);
 res.json({balances:r.rows,notice:"Test ledger only. No customer deposits or withdrawals are enabled."});
}));
// Wallet request intake only: no balance is credited/debited and no blockchain transfer occurs.
app.post("/api/wallet/deposit-requests",auth,wrap(async(req,res)=>{
 const data=z.object({asset:z.enum(["USDT","BTC","ETH"]),network:z.enum(["TRC20","ERC20","BEP20","Bitcoin","Ethereum"]),amount:z.string().regex(/^\d+(\.\d{1,18})?$/),txHash:z.string().min(8).max(180)}).parse(req.body);
 if(Number(data.amount)<=0)return res.status(400).json({error:"Amount must be greater than zero"});
 const r=await db.query("INSERT INTO wallet_requests(user_id,request_type,asset,network,amount,tx_hash) VALUES($1,'deposit',$2,$3,$4,$5) RETURNING id,request_type,asset,network,amount,status,created_at",[req.user.sub,data.asset,data.network,data.amount,data.txHash.trim()]);
 res.status(201).json({request:r.rows[0],notice:"Request recorded for review only. No funds have been credited. Use only an officially issued deposit address after licensed wallet integration is approved."});
}));
app.post("/api/wallet/withdrawal-requests",auth,wrap(async(req,res)=>{
 const data=z.object({asset:z.enum(["USDT","BTC","ETH"]),network:z.enum(["TRC20","ERC20","BEP20","Bitcoin","Ethereum"]),amount:z.string().regex(/^\d+(\.\d{1,18})?$/),walletAddress:z.string().min(12).max(180)}).parse(req.body);
 if(Number(data.amount)<=0)return res.status(400).json({error:"Amount must be greater than zero"});
 const r=await db.query("INSERT INTO wallet_requests(user_id,request_type,asset,network,amount,wallet_address) VALUES($1,'withdrawal',$2,$3,$4,$5) RETURNING id,request_type,asset,network,amount,status,created_at",[req.user.sub,data.asset,data.network,data.amount,data.walletAddress.trim()]);
 res.status(201).json({request:r.rows[0],notice:"Request recorded for review only. No balance was debited and no crypto was sent."});
}));
app.get("/api/wallet/requests",auth,wrap(async(req,res)=>{
 const r=await db.query("SELECT id,request_type,asset,network,amount,wallet_address,tx_hash,status,admin_note,created_at,reviewed_at FROM wallet_requests WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100",[req.user.sub]);
 res.json({requests:r.rows,notice:"Request history only; this API does not process funds."});
}));
// Operator review endpoints. Protect ADMIN_API_KEY and never expose it in browser code.
function adminOnly(req,res,next){const supplied=req.headers["x-admin-key"];if(!process.env.ADMIN_API_KEY||!supplied||supplied!==process.env.ADMIN_API_KEY)return res.status(403).json({error:"Admin access denied"});next();}
app.get("/api/admin/wallet-requests",adminOnly,wrap(async(req,res)=>{
 const r=await db.query("SELECT wr.*,u.email FROM wallet_requests wr JOIN users u ON u.id=wr.user_id ORDER BY wr.created_at DESC LIMIT 250");res.json({requests:r.rows});
}));
app.patch("/api/admin/wallet-requests/:id",adminOnly,wrap(async(req,res)=>{
 const data=z.object({status:z.enum(["under_review","rejected","completed_recorded"]),adminNote:z.string().max(500).optional()}).parse(req.body);
 const r=await db.query("UPDATE wallet_requests SET status=$2,admin_note=$3,reviewed_at=now() WHERE id=$1 RETURNING id,request_type,status,admin_note,reviewed_at",[req.params.id,data.status,data.adminNote||null]);
 if(!r.rowCount)return res.status(404).json({error:"Request not found"});
 res.json({request:r.rows[0],notice:"Status updated only. This action does not send, receive, credit, or debit funds."});
}));

app.get("/api/book/:symbol",wrap(async(req,res)=>{
 const symbol=req.params.symbol.toUpperCase();
 if(!/^[A-Z0-9]{3,20}_[A-Z0-9]{3,10}$/.test(symbol))return res.status(400).json({error:"Use SYMBOL_BASE format, e.g. BTC_USDT"});
 const [b,a]=await Promise.all([
 db.query("SELECT price, SUM(remaining) quantity FROM orders WHERE symbol=$1 AND side='buy' AND status IN ('open','partial') GROUP BY price ORDER BY price DESC LIMIT 20",[symbol]),
 db.query("SELECT price, SUM(remaining) quantity FROM orders WHERE symbol=$1 AND side='sell' AND status IN ('open','partial') GROUP BY price ORDER BY price ASC LIMIT 20",[symbol])
 ]);
 res.json({symbol,bids:b.rows,asks:a.rows});
}));
app.get("/api/trades/:symbol",wrap(async(req,res)=>{
 const symbol=req.params.symbol.toUpperCase();
 const r=await db.query("SELECT price,quantity,created_at FROM trades WHERE symbol=$1 ORDER BY created_at DESC LIMIT 100",[symbol]);
 res.json({symbol,trades:r.rows});
}));
/*
 * LIMIT order matching prototype. All order and ledger mutations run in one
 * database transaction. This endpoint intentionally refuses live-money use:
 * only admin-approved TEST accounts can trade, and production custody,
 * compliance, surveillance, reconciliation and security review are absent.
 */
app.post("/api/orders",auth,wrap(async(req,res)=>{
 const data=z.object({symbol:z.string().regex(/^[A-Z0-9]{3,20}_[A-Z0-9]{3,10}$/),side:z.enum(["buy","sell"]),price:z.string().regex(/^\d+(\.\d{1,18})?$/),quantity:z.string().regex(/^\d+(\.\d{1,18})?$/)}).parse(req.body);
 const cx=await db.connect();
 try{
  await cx.query("BEGIN");
  const u=await cx.query("SELECT status FROM users WHERE id=$1 FOR UPDATE",[req.user.sub]);
  if(!u.rowCount||u.rows[0].status!=="test_approved"){await cx.query("ROLLBACK");return res.status(403).json({error:"Trading disabled: account must be explicitly test-approved by an operator."});}
  const [base,quote]=data.symbol.split("_"),reserve=data.side==="buy"?(Number(data.price)*Number(data.quantity)).toFixed(18):data.quantity;
  const asset=data.side==="buy"?quote:base;
  const acc=await cx.query("SELECT available FROM accounts WHERE user_id=$1 AND asset=$2 FOR UPDATE",[req.user.sub,asset]);
  if(!acc.rowCount||Number(acc.rows[0].available)<Number(reserve)){await cx.query("ROLLBACK");return res.status(400).json({error:`Insufficient ${asset} test balance`});}
  await cx.query("UPDATE accounts SET available=available-$3,locked=locked+$3 WHERE user_id=$1 AND asset=$2",[req.user.sub,asset,reserve]);
  const ins=await cx.query("INSERT INTO orders(user_id,symbol,side,type,price,quantity,remaining) VALUES($1,$2,$3,'limit',$4,$5,$5) RETURNING *",[req.user.sub,data.symbol,data.side,data.price,data.quantity]);
  let taker=ins.rows[0],left=Number(taker.remaining);
  const opposite=data.side==="buy"?"sell":"buy";
  const matches=await cx.query(`SELECT * FROM orders WHERE symbol=$1 AND side=$2 AND status IN ('open','partial') AND user_id<>$3 AND ${data.side==="buy"?"price <= $4":"price >= $4"} ORDER BY price ${data.side==="buy"?"ASC":"DESC"},created_at ASC FOR UPDATE`,[data.symbol,opposite,req.user.sub,data.price]);
  for(const maker of matches.rows){
   if(left<=0)break;
   const q=Math.min(left,Number(maker.remaining)),p=Number(maker.price),value=q*p;
   const makerBase=data.side==="buy"?base:base, makerQuote=quote;
   // Release maker's locked reserve and credit received asset; taker's reserve was locked above.
   const makerLockedAsset=maker.side==="buy"?quote:base;
   const makerRelease=maker.side==="buy"?value:q;
   await cx.query("UPDATE accounts SET locked=locked-$3 WHERE user_id=$1 AND asset=$2",[maker.user_id,makerLockedAsset,makerRelease.toFixed(18)]);
   const makerReceiveAsset=maker.side==="buy"?base:quote;
   const makerReceive=maker.side==="buy"?q:value;
   await cx.query("INSERT INTO accounts(user_id,asset,available) VALUES($1,$2,$3) ON CONFLICT(user_id,asset) DO UPDATE SET available=accounts.available+EXCLUDED.available",[maker.user_id,makerReceiveAsset,makerReceive.toFixed(18)]);
   // Taker receives the opposite asset. Price improvement is returned to available quote balance for buy takers.
   const takerReceiveAsset=data.side==="buy"?base:quote,takerReceive=data.side==="buy"?q:value;
   await cx.query("INSERT INTO accounts(user_id,asset,available) VALUES($1,$2,$3) ON CONFLICT(user_id,asset) DO UPDATE SET available=accounts.available+EXCLUDED.available",[req.user.sub,takerReceiveAsset,takerReceive.toFixed(18)]);
   if(data.side==="buy"&&Number(taker.price)>p){const rebate=(Number(taker.price)-p)*q;await cx.query("UPDATE accounts SET locked=locked-$3,available=available+$3 WHERE user_id=$1 AND asset=$2",[req.user.sub,quote,rebate.toFixed(18)]);}
   const makerLeft=Number(maker.remaining)-q;left-=q;
   await cx.query("UPDATE orders SET remaining=$2,status=$3 WHERE id=$1",[maker.id,makerLeft.toFixed(18),makerLeft===0?"filled":"partial"]);
   await cx.query("INSERT INTO trades(symbol,maker_order_id,taker_order_id,maker_user_id,taker_user_id,price,quantity) VALUES($1,$2,$3,$4,$5,$6,$7)",[data.symbol,maker.id,taker.id,maker.user_id,req.user.sub,p.toFixed(18),q.toFixed(18)]);
  }
  const filled=Number(taker.quantity)-left;
  await cx.query("UPDATE orders SET remaining=$2,status=$3 WHERE id=$1",[taker.id,left.toFixed(18),left===0?"filled":filled>0?"partial":"open"]);
  await cx.query("COMMIT");
  res.status(201).json({order:{...taker,remaining:left,status:left===0?"filled":filled>0?"partial":"open"},filledQuantity:filled,warning:"Test ledger only. This is not a production exchange or a real-money execution service."});
 }catch(e){await cx.query("ROLLBACK");throw e;}finally{cx.release();}
}));
app.use((err,req,res,next)=>{console.error(err);if(err.name==="ZodError")return res.status(400).json({error:"Invalid request",details:err.issues});res.status(500).json({error:"Internal server error"});});
const port=Number(process.env.PORT||4000);app.listen(port,()=>console.log(`ChoozaCoinX API listening on ${port}`));
