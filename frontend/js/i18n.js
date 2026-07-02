/**
 * BUNNYDJPOS — i18n Bilingüe
 * Muestra el español como texto principal y el idioma secundario debajo en pequeño.
 * No hay botón de cambio: ambos idiomas se ven simultáneamente.
 */
(function () {

// ── Diccionarios de traducción ────────────────────────────────
const T = {
  es: {
    // Secciones sidebar
    'sec.general':'General','sec.operacion':'Operación','sec.finanzas':'Finanzas',
    'sec.rrhh':'Personal','sec.config':'Configuración','sec.portales':'Accesos directos',
    // Nav
    'nav.dashboard':'Dashboard','nav.caja':'Caja del día','nav.gastos':'Gastos',
    'nav.reportes':'Reportes','nav.clientes':'Clientes','nav.facturas':'Reimprimir',
    'nav.inventario':'Inventario','nav.mesas-admin':'Mesas','nav.editar-menu':'Editar menú',
    'nav.proveedores':'Proveedores','nav.pedidos-prov':'Pedidos prov.',
    'nav.personal':'Usuarios','nav.roles':'Roles','nav.horarios':'Horarios',
    'nav.asistencia':'Asistencia','nav.cfg-factura':'Factura','nav.cfg-impresora':'Impresora',
    'nav.agenda':'Agenda','nav.servicios':'Servicios','nav.paquetes':'Paquetes',
    'nav.comisiones':'Comisiones','nav.empleados':'Empleados',
    // Botones
    'Guardar':'Guardar','Cancelar':'Cancelar','Nuevo':'Nuevo','Nueva':'Nueva',
    'Editar':'Editar','Eliminar':'Eliminar','Buscar':'Buscar','Exportar':'Exportar',
    'Importar':'Importar','Cerrar':'Cerrar','Enviar':'Enviar','Imprimir':'Imprimir',
    'Actualizar':'Actualizar','Agregar':'Agregar','Ver':'Ver','Aplicar':'Aplicar',
    'Confirmar':'Confirmar','Aceptar':'Aceptar','Salir':'Salir','Ayuda':'Ayuda',
    'Guardar cambios':'Guardar cambios','Nuevo producto':'Nuevo producto',
    'Nuevo cliente':'Nuevo cliente','Nuevo proveedor':'Nuevo proveedor',
    'Nueva venta':'Nueva venta','Nuevo gasto':'Nuevo gasto','Nueva cita':'Nueva cita',
    'Exportar Excel':'Exportar Excel','Importar Excel':'Importar Excel',
    'Enviar solicitud':'Enviar solicitud','Crear y agregar al pedido':'Crear y agregar al pedido',
    '+ Añadir':'+ Añadir','+ Crear nuevo producto':'+ Crear nuevo producto',
    'Cerrar sesión':'Cerrar sesión',
    // Títulos de panel
    'Dashboard':'Dashboard','Inventario':'Inventario','Proveedores':'Proveedores',
    'Reportes':'Reportes','Personal':'Personal','Roles':'Roles','Horarios':'Horarios',
    'Asistencia':'Asistencia','Clientes':'Clientes','Gastos':'Gastos','Mesas':'Mesas',
    'Facturación':'Facturación','Caja del día':'Caja del día','Agenda':'Agenda',
    'Servicios':'Servicios','Paquetes':'Paquetes','Comisiones':'Comisiones',
    'Solicitudes a proveedores':'Solicitudes a proveedores',
    'Resumen del negocio':'Resumen del negocio','Detalle de ventas':'Detalle de ventas',
    'Ventas del período':'Ventas del período','Métodos de pago':'Métodos de pago',
    'Productos más vendidos':'Productos más vendidos',
    'Nueva solicitud de pedido':'Nueva solicitud de pedido',
    'Nuevo producto para este proveedor':'Nuevo producto para este proveedor',
    'Agregar producto al pedido':'Agregar producto al pedido',
    'Items del pedido':'Items del pedido','Impuesto sobre ventas':'Impuesto sobre ventas',
    'Código de barras':'Código de barras','Unidad de Medida':'Unidad de Medida',
    // Encabezados de tabla
    'Nombre':'Nombre','Email':'Email','Teléfono':'Teléfono','Dirección':'Dirección',
    'Ciudad':'Ciudad','NIT':'NIT','Descripción':'Descripción','Precio':'Precio',
    'Costo':'Costo','Stock':'Stock','Categoría':'Categoría','Proveedor':'Proveedor',
    'Notas':'Notas','Fecha':'Fecha','Total':'Total','Estado':'Estado','Acciones':'Acciones',
    'Cantidad':'Cantidad','Código':'Código','Unidad':'Unidad','Cliente':'Cliente',
    'Cajero':'Cajero','Método':'Método','Factura':'Factura','Hora':'Hora','Lugar':'Lugar',
    'Subtotal':'Subtotal','IVA':'IVA','Costo unit.':'Costo unit.','Producto':'Producto',
    'Empleado':'Empleado','Rol':'Rol','Usuario':'Usuario','Cant.':'Cant.',
    'Cant. por paquete':'Cant. por paquete','Cant. por caja':'Cant. por caja',
    'Total c/IVA':'Total c/IVA',
    // Labels de formularios
    'Nombre *':'Nombre *','Tipo':'Tipo','Categoría':'Categoría',
    'Fecha de entrega esperada':'Fecha de entrega esperada',
    'Costo compra':'Costo compra','Con IVA 19%':'Con IVA 19%',
    'Exento de IVA':'Exento de IVA','IVA 19% aplicado':'IVA 19% aplicado',
    'Proveedor *':'Proveedor *','Producto':'Producto','Costo unit.':'Costo unit.',
    'Cantidad por paquete':'Cantidad por paquete','Cantidad por caja':'Cantidad por caja',
    'Cantidad por bolsa':'Cantidad por bolsa',
    'Departamento / Región':'Departamento / Región','Idiomas del sistema':'Idiomas del sistema',
    // Estado badges
    'Activo':'Activo','Inactivo':'Inactivo','Pendiente':'Pendiente',
    'Completado':'Completado','Cancelado':'Cancelado','Enviado':'Enviado',
    'Recibido':'Recibido','Pagado':'Pagado',
  },

  en: {
    'sec.general':'General','sec.operacion':'Operations','sec.finanzas':'Finance',
    'sec.rrhh':'Staff','sec.config':'Settings','sec.portales':'Quick Links',
    'nav.dashboard':'Dashboard','nav.caja':'Daily Cash','nav.gastos':'Expenses',
    'nav.reportes':'Reports','nav.clientes':'Customers','nav.facturas':'Reprint',
    'nav.inventario':'Inventory','nav.mesas-admin':'Tables','nav.editar-menu':'Edit Menu',
    'nav.proveedores':'Suppliers','nav.pedidos-prov':'Purchase Orders',
    'nav.personal':'Users','nav.roles':'Roles','nav.horarios':'Schedules',
    'nav.asistencia':'Attendance','nav.cfg-factura':'Invoice','nav.cfg-impresora':'Printer',
    'nav.agenda':'Appointments','nav.servicios':'Services','nav.paquetes':'Packages',
    'nav.comisiones':'Commissions','nav.empleados':'Employees',
    'Guardar':'Save','Cancelar':'Cancel','Nuevo':'New','Nueva':'New',
    'Editar':'Edit','Eliminar':'Delete','Buscar':'Search','Exportar':'Export',
    'Importar':'Import','Cerrar':'Close','Enviar':'Send','Imprimir':'Print',
    'Actualizar':'Refresh','Agregar':'Add','Ver':'View','Aplicar':'Apply',
    'Confirmar':'Confirm','Aceptar':'Accept','Salir':'Logout','Ayuda':'Help',
    'Guardar cambios':'Save changes','Nuevo producto':'New product',
    'Nuevo cliente':'New customer','Nuevo proveedor':'New supplier',
    'Nueva venta':'New sale','Nuevo gasto':'New expense','Nueva cita':'New appointment',
    'Exportar Excel':'Export Excel','Importar Excel':'Import Excel',
    'Enviar solicitud':'Send request','Crear y agregar al pedido':'Create & add to order',
    '+ Añadir':'+ Add','+ Crear nuevo producto':'+ Create new product',
    'Cerrar sesión':'Logout',
    'Dashboard':'Dashboard','Inventario':'Inventory','Proveedores':'Suppliers',
    'Reportes':'Reports','Personal':'Staff','Roles':'Roles','Horarios':'Schedules',
    'Asistencia':'Attendance','Clientes':'Customers','Gastos':'Expenses','Mesas':'Tables',
    'Facturación':'Billing','Caja del día':'Daily Cash','Agenda':'Appointments',
    'Servicios':'Services','Paquetes':'Packages','Comisiones':'Commissions',
    'Solicitudes a proveedores':'Supplier Requests',
    'Resumen del negocio':'Business Summary','Detalle de ventas':'Sales Detail',
    'Ventas del período':'Period Sales','Métodos de pago':'Payment Methods',
    'Productos más vendidos':'Best Sellers',
    'Nueva solicitud de pedido':'New Purchase Order',
    'Nuevo producto para este proveedor':'New product for this supplier',
    'Agregar producto al pedido':'Add product to order',
    'Items del pedido':'Order Items','Impuesto sobre ventas':'Sales Tax',
    'Código de barras':'Barcode','Unidad de Medida':'Unit of Measure',
    'Nombre':'Name','Email':'Email','Teléfono':'Phone','Dirección':'Address',
    'Ciudad':'City','NIT':'Tax ID','Descripción':'Description','Precio':'Price',
    'Costo':'Cost','Stock':'Stock','Categoría':'Category','Proveedor':'Supplier',
    'Notas':'Notes','Fecha':'Date','Total':'Total','Estado':'Status','Acciones':'Actions',
    'Cantidad':'Quantity','Código':'Code','Unidad':'Unit','Cliente':'Customer',
    'Cajero':'Cashier','Método':'Method','Factura':'Invoice','Hora':'Time','Lugar':'Location',
    'Subtotal':'Subtotal','IVA':'Tax','Costo unit.':'Unit cost','Producto':'Product',
    'Empleado':'Employee','Rol':'Role','Usuario':'User','Cant.':'Qty.',
    'Total c/IVA':'Total w/Tax',
    'Nombre *':'Name *','Tipo':'Type',
    'Fecha de entrega esperada':'Expected delivery date',
    'Costo compra':'Purchase cost','Con IVA 19%':'With 19% Tax',
    'Exento de IVA':'Tax Exempt','IVA 19% aplicado':'19% Tax applied',
    'Proveedor *':'Supplier *',
    'Cantidad por paquete':'Qty per package','Cantidad por caja':'Qty per box',
    'Cantidad por bolsa':'Qty per bag',
    'Departamento / Región':'Department / Region','Idiomas del sistema':'System Languages',
    'Activo':'Active','Inactivo':'Inactive','Pendiente':'Pending',
    'Completado':'Completed','Cancelado':'Cancelled','Enviado':'Sent',
    'Recibido':'Received','Pagado':'Paid',
  },

  pt: {
    'sec.general':'Geral','sec.operacion':'Operação','sec.finanzas':'Finanças',
    'sec.rrhh':'Pessoal','sec.config':'Configurações','sec.portales':'Atalhos',
    'nav.dashboard':'Painel','nav.caja':'Caixa do dia','nav.gastos':'Despesas',
    'nav.reportes':'Relatórios','nav.clientes':'Clientes','nav.facturas':'Reimprimir',
    'nav.inventario':'Inventário','nav.mesas-admin':'Mesas','nav.editar-menu':'Editar cardápio',
    'nav.proveedores':'Fornecedores','nav.pedidos-prov':'Pedidos forn.',
    'nav.personal':'Usuários','nav.roles':'Funções','nav.horarios':'Horários',
    'nav.asistencia':'Assiduidade','nav.cfg-factura':'Fatura','nav.cfg-impresora':'Impressora',
    'nav.agenda':'Agenda','nav.servicios':'Serviços','nav.paquetes':'Pacotes',
    'nav.comisiones':'Comissões','nav.empleados':'Funcionários',
    'Guardar':'Salvar','Cancelar':'Cancelar','Nuevo':'Novo','Nueva':'Nova',
    'Editar':'Editar','Eliminar':'Excluir','Buscar':'Buscar','Exportar':'Exportar',
    'Importar':'Importar','Cerrar':'Fechar','Enviar':'Enviar','Imprimir':'Imprimir',
    'Actualizar':'Atualizar','Agregar':'Adicionar','Ver':'Ver','Aplicar':'Aplicar',
    'Confirmar':'Confirmar','Aceptar':'Aceitar','Salir':'Sair','Ayuda':'Ajuda',
    'Guardar cambios':'Salvar alterações','Nuevo producto':'Novo produto',
    'Nuevo cliente':'Novo cliente','Nuevo proveedor':'Novo fornecedor',
    'Nueva venta':'Nova venda','Nuevo gasto':'Nova despesa','Nueva cita':'Nova consulta',
    'Exportar Excel':'Exportar Excel','Importar Excel':'Importar Excel',
    'Enviar solicitud':'Enviar pedido','Crear y agregar al pedido':'Criar e adicionar ao pedido',
    '+ Añadir':'+ Adicionar','+ Crear nuevo producto':'+ Criar novo produto',
    'Cerrar sesión':'Sair',
    'Dashboard':'Painel','Inventario':'Inventário','Proveedores':'Fornecedores',
    'Reportes':'Relatórios','Personal':'Pessoal','Roles':'Funções','Horarios':'Horários',
    'Asistencia':'Assiduidade','Clientes':'Clientes','Gastos':'Despesas','Mesas':'Mesas',
    'Facturación':'Faturamento','Caja del día':'Caixa do dia','Agenda':'Agenda',
    'Servicios':'Serviços','Paquetes':'Pacotes','Comisiones':'Comissões',
    'Solicitudes a proveedores':'Pedidos a fornecedores',
    'Resumen del negocio':'Resumo do negócio','Detalle de ventas':'Detalhe de vendas',
    'Ventas del período':'Vendas do período','Métodos de pago':'Formas de pagamento',
    'Productos más vendidos':'Mais vendidos',
    'Nueva solicitud de pedido':'Novo pedido de compra',
    'Nuevo producto para este proveedor':'Novo produto para este fornecedor',
    'Agregar producto al pedido':'Adicionar produto ao pedido',
    'Items del pedido':'Itens do pedido','Impuesto sobre ventas':'Imposto sobre vendas',
    'Código de barras':'Código de barras','Unidad de Medida':'Unidade de medida',
    'Nombre':'Nome','Email':'E-mail','Teléfono':'Telefone','Dirección':'Endereço',
    'Ciudad':'Cidade','NIT':'CNPJ','Descripción':'Descrição','Precio':'Preço',
    'Costo':'Custo','Stock':'Estoque','Categoría':'Categoria','Proveedor':'Fornecedor',
    'Notas':'Notas','Fecha':'Data','Total':'Total','Estado':'Estado','Acciones':'Ações',
    'Cantidad':'Quantidade','Código':'Código','Unidad':'Unidade','Cliente':'Cliente',
    'Cajero':'Caixa','Método':'Método','Factura':'Nota fiscal','Hora':'Hora','Lugar':'Local',
    'Subtotal':'Subtotal','IVA':'IVA','Costo unit.':'Custo unit.','Producto':'Produto',
    'Empleado':'Funcionário','Rol':'Função','Usuario':'Usuário','Cant.':'Qtd.',
    'Total c/IVA':'Total c/IVA',
    'Nombre *':'Nome *','Tipo':'Tipo',
    'Fecha de entrega esperada':'Data de entrega esperada',
    'Costo compra':'Custo de compra','Con IVA 19%':'Com IVA 19%',
    'Exento de IVA':'Isento de IVA','IVA 19% aplicado':'IVA 19% aplicado',
    'Proveedor *':'Fornecedor *',
    'Cantidad por paquete':'Qtd. por pacote','Cantidad por caja':'Qtd. por caixa',
    'Cantidad por bolsa':'Qtd. por bolsa',
    'Departamento / Región':'Departamento / Região','Idiomas del sistema':'Idiomas do sistema',
    'Activo':'Ativo','Inactivo':'Inativo','Pendiente':'Pendente',
    'Completado':'Concluído','Cancelado':'Cancelado','Enviado':'Enviado',
    'Recibido':'Recebido','Pagado':'Pago',
  },

  fr: {
    'sec.general':'Général','sec.operacion':'Opérations','sec.finanzas':'Finances',
    'sec.rrhh':'Personnel','sec.config':'Paramètres','sec.portales':'Raccourcis',
    'nav.dashboard':'Tableau de bord','nav.caja':'Caisse du jour','nav.gastos':'Dépenses',
    'nav.reportes':'Rapports','nav.clientes':'Clients','nav.facturas':'Réimprimer',
    'nav.inventario':'Inventaire','nav.mesas-admin':'Tables','nav.editar-menu':'Modifier menu',
    'nav.proveedores':'Fournisseurs','nav.pedidos-prov':'Commandes fourn.',
    'nav.personal':'Utilisateurs','nav.roles':'Rôles','nav.horarios':'Horaires',
    'nav.asistencia':'Présences','nav.cfg-factura':'Facture','nav.cfg-impresora':'Imprimante',
    'nav.agenda':'Agenda','nav.servicios':'Services','nav.paquetes':'Forfaits',
    'nav.comisiones':'Commissions','nav.empleados':'Employés',
    'Guardar':'Enregistrer','Cancelar':'Annuler','Nuevo':'Nouveau','Nueva':'Nouvelle',
    'Editar':'Modifier','Eliminar':'Supprimer','Buscar':'Rechercher','Exportar':'Exporter',
    'Importar':'Importer','Cerrar':'Fermer','Enviar':'Envoyer','Imprimir':'Imprimer',
    'Actualizar':'Actualiser','Agregar':'Ajouter','Ver':'Voir','Aplicar':'Appliquer',
    'Confirmar':'Confirmer','Aceptar':'Accepter','Salir':'Déconnexion','Ayuda':'Aide',
    'Guardar cambios':'Enregistrer','Nuevo producto':'Nouveau produit',
    'Nuevo cliente':'Nouveau client','Nuevo proveedor':'Nouveau fournisseur',
    'Nueva venta':'Nouvelle vente','Nuevo gasto':'Nouvelle dépense','Nueva cita':'Nouveau RDV',
    'Exportar Excel':'Exporter Excel','Importar Excel':'Importer Excel',
    'Enviar solicitud':'Envoyer commande','Crear y agregar al pedido':'Créer et ajouter',
    '+ Añadir':'+ Ajouter','+ Crear nuevo producto':'+ Créer nouveau produit',
    'Cerrar sesión':'Déconnexion',
    'Dashboard':'Tableau de bord','Inventario':'Inventaire','Proveedores':'Fournisseurs',
    'Reportes':'Rapports','Personal':'Personnel','Roles':'Rôles','Horarios':'Horaires',
    'Asistencia':'Présences','Clientes':'Clients','Gastos':'Dépenses','Mesas':'Tables',
    'Facturación':'Facturation','Caja del día':'Caisse du jour','Agenda':'Agenda',
    'Servicios':'Services','Paquetes':'Forfaits','Comisiones':'Commissions',
    'Solicitudes a proveedores':'Commandes fournisseurs',
    'Resumen del negocio':'Résumé','Detalle de ventas':'Détail des ventes',
    'Ventas del período':'Ventes de la période','Métodos de pago':'Modes de paiement',
    'Productos más vendidos':'Meilleures ventes',
    'Nueva solicitud de pedido':'Nouvelle commande',
    'Nuevo producto para este proveedor':'Nouveau produit pour ce fournisseur',
    'Agregar producto al pedido':'Ajouter produit à la commande',
    'Items del pedido':'Articles de la commande','Impuesto sobre ventas':'Taxe de vente',
    'Código de barras':'Code-barres','Unidad de Medida':'Unité de mesure',
    'Nombre':'Nom','Email':'E-mail','Teléfono':'Téléphone','Dirección':'Adresse',
    'Ciudad':'Ville','NIT':'SIRET','Descripción':'Description','Precio':'Prix',
    'Costo':'Coût','Stock':'Stock','Categoría':'Catégorie','Proveedor':'Fournisseur',
    'Notas':'Notes','Fecha':'Date','Total':'Total','Estado':'Statut','Acciones':'Actions',
    'Cantidad':'Quantité','Código':'Code','Unidad':'Unité','Cliente':'Client',
    'Cajero':'Caissier','Método':'Méthode','Factura':'Facture','Hora':'Heure','Lugar':'Lieu',
    'Subtotal':'Sous-total','IVA':'TVA','Costo unit.':'Coût unit.','Producto':'Produit',
    'Empleado':'Employé','Rol':'Rôle','Usuario':'Utilisateur','Cant.':'Qté.',
    'Total c/IVA':'Total TTC',
    'Nombre *':'Nom *','Tipo':'Type',
    'Fecha de entrega esperada':'Date de livraison prévue',
    'Costo compra':'Coût d\'achat','Con IVA 19%':'Avec TVA 19%',
    'Exento de IVA':'Exonéré de TVA','IVA 19% aplicado':'TVA 19% appliquée',
    'Proveedor *':'Fournisseur *',
    'Cantidad por paquete':'Qté par paquet','Cantidad por caja':'Qté par boîte',
    'Cantidad por bolsa':'Qté par sachet',
    'Departamento / Región':'Département / Région','Idiomas del sistema':'Langues du système',
    'Activo':'Actif','Inactivo':'Inactif','Pendiente':'En attente',
    'Completado':'Terminé','Cancelado':'Annulé','Enviado':'Envoyé',
    'Recibido':'Reçu','Pagado':'Payé',
  },

  zh: {
    'sec.general':'概览','sec.operacion':'运营','sec.finanzas':'财务',
    'sec.rrhh':'员工','sec.config':'设置','sec.portales':'快速链接',
    'nav.dashboard':'仪表板','nav.caja':'今日收银','nav.gastos':'支出',
    'nav.reportes':'报告','nav.clientes':'客户','nav.facturas':'重新打印',
    'nav.inventario':'库存','nav.mesas-admin':'桌位','nav.editar-menu':'编辑菜单',
    'nav.proveedores':'供应商','nav.pedidos-prov':'采购订单',
    'nav.personal':'用户','nav.roles':'角色','nav.horarios':'排班',
    'nav.asistencia':'考勤','nav.cfg-factura':'发票','nav.cfg-impresora':'打印机',
    'nav.agenda':'预约','nav.servicios':'服务','nav.paquetes':'套餐',
    'nav.comisiones':'佣金','nav.empleados':'员工',
    'Guardar':'保存','Cancelar':'取消','Nuevo':'新建','Nueva':'新建',
    'Editar':'编辑','Eliminar':'删除','Buscar':'搜索','Exportar':'导出',
    'Importar':'导入','Cerrar':'关闭','Enviar':'发送','Imprimir':'打印',
    'Actualizar':'刷新','Agregar':'添加','Ver':'查看','Aplicar':'应用',
    'Confirmar':'确认','Aceptar':'接受','Salir':'退出','Ayuda':'帮助',
    'Guardar cambios':'保存更改','Nuevo producto':'新产品',
    'Nuevo cliente':'新客户','Nuevo proveedor':'新供应商',
    'Nueva venta':'新销售','Nuevo gasto':'新支出','Nueva cita':'新预约',
    'Exportar Excel':'导出Excel','Importar Excel':'导入Excel',
    'Enviar solicitud':'发送请求','Crear y agregar al pedido':'创建并添加到订单',
    '+ Añadir':'+ 添加','+ Crear nuevo producto':'+ 创建新产品',
    'Cerrar sesión':'退出登录',
    'Dashboard':'仪表板','Inventario':'库存','Proveedores':'供应商',
    'Reportes':'报告','Personal':'员工','Roles':'角色','Horarios':'排班',
    'Asistencia':'考勤','Clientes':'客户','Gastos':'支出','Mesas':'桌位',
    'Facturación':'账单','Caja del día':'今日收银','Agenda':'预约',
    'Servicios':'服务','Paquetes':'套餐','Comisiones':'佣金',
    'Solicitudes a proveedores':'供应商订单',
    'Resumen del negocio':'业务摘要','Detalle de ventas':'销售明细',
    'Ventas del período':'期间销售','Métodos de pago':'付款方式',
    'Productos más vendidos':'畅销产品',
    'Nueva solicitud de pedido':'新采购订单',
    'Nuevo producto para este proveedor':'为此供应商创建新产品',
    'Agregar producto al pedido':'将产品添加到订单',
    'Items del pedido':'订单项目','Impuesto sobre ventas':'销售税',
    'Código de barras':'条形码','Unidad de Medida':'计量单位',
    'Nombre':'名称','Email':'邮箱','Teléfono':'电话','Dirección':'地址',
    'Ciudad':'城市','NIT':'税号','Descripción':'描述','Precio':'价格',
    'Costo':'成本','Stock':'库存','Categoría':'类别','Proveedor':'供应商',
    'Notas':'备注','Fecha':'日期','Total':'合计','Estado':'状态','Acciones':'操作',
    'Cantidad':'数量','Código':'编码','Unidad':'单位','Cliente':'客户',
    'Cajero':'收银员','Método':'方式','Factura':'发票','Hora':'时间','Lugar':'地点',
    'Subtotal':'小计','IVA':'税','Costo unit.':'单位成本','Producto':'产品',
    'Empleado':'员工','Rol':'角色','Usuario':'用户','Cant.':'数量',
    'Total c/IVA':'含税合计',
    'Nombre *':'名称 *','Tipo':'类型',
    'Fecha de entrega esperada':'预计交货日期',
    'Costo compra':'采购成本','Con IVA 19%':'含19%税',
    'Exento de IVA':'免税','IVA 19% aplicado':'已应用19%税',
    'Proveedor *':'供应商 *',
    'Cantidad por paquete':'每包数量','Cantidad por caja':'每箱数量',
    'Cantidad por bolsa':'每袋数量',
    'Departamento / Región':'省份 / 地区','Idiomas del sistema':'系统语言',
    'Activo':'活跃','Inactivo':'停用','Pendiente':'待处理',
    'Completado':'已完成','Cancelado':'已取消','Enviado':'已发送',
    'Recibido':'已收到','Pagado':'已付款',
  }
};

// Grupos sidebar peluquería → clave de sección
const GRP_SEC = {
  'grp-principal':'sec.general','grp-finanzas':'sec.finanzas',
  'grp-personal':'sec.rrhh','grp-cfg':'sec.config','grp-portales':'sec.portales',
};

// ── CSS para el subtítulo bilingüe ──────────────────────────
document.head.insertAdjacentHTML('beforeend', `<style>
.i18n-sub{display:block;font-size:9.5px;color:var(--text3,#999);font-weight:400;line-height:1.4;opacity:.82;white-space:normal;pointer-events:none}
.nav-label .i18n-sub{margin-top:1px}
th .i18n-sub,label .i18n-sub{opacity:.7}
button .i18n-sub{display:block;font-size:9px;opacity:.7;font-weight:400}
</style>`);

// ── Estado ─────────────────────────────────────────────────
let _lang2 = null;
let _reverseMap = {};
let _observing = false;
let _debounce = null;

function buildReverseMap(lang2) {
  const dict2 = T[lang2] || {}, map = {};
  Object.keys(T.es).forEach(k => {
    if (k.startsWith('sec.') || k.startsWith('nav.')) return;
    const t2 = dict2[k];
    if (t2 && t2 !== k) map[k] = t2;
  });
  return map;
}

function addSub(el, t2) {
  let sub = el.querySelector(':scope > .i18n-sub');
  if (!t2) { if (sub) sub.remove(); return; }
  if (!sub) { sub = document.createElement('span'); sub.className = 'i18n-sub'; el.appendChild(sub); }
  if (sub.textContent !== t2) sub.textContent = t2;
}

function directText(el) {
  let t = '';
  for (const n of el.childNodes) { if (n.nodeType === 3) t += n.textContent; }
  return t.trim();
}

function applyBilingualSidebar() {
  if (!_lang2) return;
  const d2 = T[_lang2] || {};
  document.querySelectorAll('.nav-section[data-seccion]').forEach(sec => {
    const lbl = sec.querySelector('.nav-label');
    if (lbl) addSub(lbl, d2['sec.' + sec.getAttribute('data-seccion')]);
  });
  document.querySelectorAll('.nav-btn[onclick]').forEach(btn => {
    const m = btn.getAttribute('onclick').match(/nav\(['"]([^'"]+)['"]/);
    if (!m) return;
    const lbl = btn.querySelector('.nav-label');
    if (lbl) addSub(lbl, d2['nav.' + m[1]]);
  });
  document.querySelectorAll('.nav-item[data-nav]').forEach(el => addSub(el, d2['nav.' + el.getAttribute('data-nav')]));
  document.querySelectorAll('.nav-sep[onclick]').forEach(sep => {
    const m = sep.getAttribute('onclick').match(/toggleGrupo\(['"]([^'"]+)['"]\)/);
    if (m && GRP_SEC[m[1]]) addSub(sep, d2[GRP_SEC[m[1]]]);
  });
}

function applyBilingualContent(root) {
  if (!_lang2 || !root) return;
  root.querySelectorAll('h1,h2,h3,h4,h5').forEach(el => addSub(el, _reverseMap[directText(el)]));
  root.querySelectorAll('th').forEach(el => addSub(el, _reverseMap[directText(el)]));
  root.querySelectorAll('.field label,.modal label,label.lbl').forEach(el => addSub(el, _reverseMap[directText(el)]));
  root.querySelectorAll('button.btn,.btn-primary,.btn-outline,.btn-danger,.btn-success').forEach(el => {
    if (el.querySelector('.nav-icon,.nav-label,img,svg')) return;
    addSub(el, _reverseMap[directText(el)]);
  });
  root.querySelectorAll('[data-i18n]').forEach(el => addSub(el, (T[_lang2]||{})[el.getAttribute('data-i18n')]));
}

function applyAll() {
  applyBilingualSidebar();
  applyBilingualContent(document.body);
}

function startObserver() {
  if (_observing) return;
  _observing = true;
  new MutationObserver(muts => {
    if (!_lang2) return;
    const real = muts.some(m => [...m.addedNodes].some(n => n.nodeType === 1 && !n.classList?.contains('i18n-sub')));
    if (!real) return;
    clearTimeout(_debounce);
    _debounce = setTimeout(applyAll, 160);
  }).observe(document.body, { childList: true, subtree: true });
}

function activate(lang2) {
  if (!T[lang2] || lang2 === 'es') return;
  _lang2 = lang2;
  _reverseMap = buildReverseMap(lang2);
  localStorage.setItem('djpos_lang2', lang2);
  const wrap = document.getElementById('lang-switcher');
  if (wrap) wrap.style.display = 'none';
  startObserver();
  applyAll();
}

// ── Auto-init desde localStorage al cargar la página ───────
(function () {
  const stored = localStorage.getItem('djpos_lang2');
  if (!stored || !T[stored] || stored === 'es') return;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(() => activate(stored), 80));
  } else {
    setTimeout(() => activate(stored), 80);
  }
})();

// ── API pública ────────────────────────────────────────────

window.initLangSwitcher = function (langs) {
  const wrap = document.getElementById('lang-switcher');
  if (wrap) wrap.style.display = 'none';

  const lang2 = langs && langs.length > 1 ? (langs.find(l => l !== 'es') || null) : null;

  if (!lang2 || !T[lang2]) {
    // El negocio no tiene idioma secundario → limpiar todo
    localStorage.removeItem('djpos_lang2');
    document.querySelectorAll('.i18n-sub').forEach(el => el.remove());
    _lang2 = null; _reverseMap = {};
    return;
  }

  activate(lang2);
};

/**
 * Forzar idioma bilingüe desde la consola del navegador:
 *   setLang2('en')   → inglés bajo cada texto
 *   setLang2('zh')   → mandarín bajo cada texto
 *   setLang2('pt')   → portugués
 *   setLang2('fr')   → francés
 *   setLang2(null)   → desactivar modo bilingüe
 */
window.setLang2 = function (lang) {
  if (!lang) {
    localStorage.removeItem('djpos_lang2');
    document.querySelectorAll('.i18n-sub').forEach(el => el.remove());
    _lang2 = null; _reverseMap = {};
    console.info('[i18n] Modo bilingüe desactivado.');
    return;
  }
  if (!T[lang]) {
    console.warn('[i18n] Idioma no soportado:', lang, '| Disponibles:', Object.keys(T).join(', '));
    return;
  }
  activate(lang);
  console.info('[i18n] Idioma secundario activado:', lang, '(guardado en localStorage)');
};

window.applyI18nContent = function (root) { applyBilingualContent(root || document.body); };

})();
