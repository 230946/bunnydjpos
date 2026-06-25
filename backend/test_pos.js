require("dotenv").config();
const {pool}=require("./db");
(async()=>{
  const {rows:svcs}=await pool.query("SELECT id,nombre,precio,duracion_min FROM pel_servicios WHERE activo=1 LIMIT 5");
  const {rows:prods}=await pool.query("SELECT id,nombre,precio_venta,stock_actual FROM pel_productos WHERE activo=1 LIMIT 5");
  const {rows:emps}=await pool.query("SELECT id,nombre FROM pel_empleados WHERE activo=1 LIMIT 3");
  console.log("SERVICIOS:", svcs.length, svcs.map(s=>s.nombre+"="+s.precio).join(", "));
  console.log("PRODUCTOS:", prods.length, prods.map(p=>p.nombre+"="+p.precio_venta+" stock="+p.stock_actual).join(", "));
  console.log("EMPLEADOS:", emps.length, emps.map(e=>e.nombre).join(", "));
  const {rows:paq}=await pool.query("SELECT id,nombre,precio FROM pel_paquetes WHERE activo=1 LIMIT 3");
  console.log("PAQUETES:", paq.length);
  const {rows:caja}=await pool.query("SELECT id,estado,monto_inicial FROM pel_cajas WHERE estado=? ORDER BY fecha_apertura DESC LIMIT 1",["abierta"]);
  console.log("CAJA:", caja[0]?("abierta id="+caja[0].id):"cerrada");
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});

