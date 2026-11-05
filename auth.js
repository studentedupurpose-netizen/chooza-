const jwt = require("jsonwebtoken");
function auth(req,res,next){
  const h=req.headers.authorization||"";
  const token=h.startsWith("Bearer ")?h.slice(7):"";
  if(!token)return res.status(401).json({error:"Authentication required"});
  try{req.user=jwt.verify(token,process.env.JWT_SECRET);next();}
  catch{return res.status(401).json({error:"Invalid or expired token"});}
}
module.exports=auth;
