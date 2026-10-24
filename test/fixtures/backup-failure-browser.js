// Isolated import fault: abort only transactions writing this fictional row.
(()=>{
 const key=JSON.stringify(['qa-local','qa-import']);
 const put=IDBObjectStore.prototype.put;
 window.backupFaults=0;
 IDBObjectStore.prototype.put=function(value,...args){
  if(this.name==='details'&&value?.key===key){window.backupFaults++;this.transaction.abort();throw new DOMException('模拟缓存写入失败','AbortError');}
  return put.call(this,value,...args);
 };
 localStorage.setItem('rcm.qa-import-existing','原设置');
 sessionStorage.setItem('rcm.qa-import-existing','原标签页');
 localStorage.setItem('qa-outside-scope','保留范围外设置');
})();
