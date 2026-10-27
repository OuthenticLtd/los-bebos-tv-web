(function(){
  var key='';try{var fragment=new URLSearchParams(location.hash.slice(1));key=fragment.get('tvnotes')||localStorage.getItem('tvhome.todo.key')||'';if(key){localStorage.setItem('tvhome.todo.key',key);history.replaceState(null,'',location.pathname+location.search);}}catch(e){}
  if(!key||!window.TV_HOME_NOTES_RENDER)return;
  var endpoint='https://anitka-macbook.tailc505f3.ts.net/tv-notes',busy=false,last=null;
  try{var cached=JSON.parse(localStorage.getItem('tvhome.todo.cache')||'null');if(cached&&cached.key===key&&cached.data&&Array.isArray(cached.data.tasks))last=cached.data;}catch(e){}
  window.TV_HOME_NOTES_RENDER(last?Object.assign({},last,{stale:true}):{tasks:[],loading:true});
  function request(){return new Promise(function(resolve,reject){var done=false,controller=window.AbortController?new AbortController():null;
    var timer=setTimeout(function(){if(done)return;done=true;if(controller)controller.abort();reject(Error('Notes timeout'));},12000);
    function finish(error,data){if(done)return;done=true;clearTimeout(timer);if(error)reject(error);else resolve(data);}
    fetch(endpoint,{cache:'no-store',headers:{'X-TV-Notes-Key':key},signal:controller?controller.signal:undefined}).then(function(r){if(!r.ok)throw Error('Notes unavailable');return r.json();}).then(function(j){finish(null,j);},function(e){finish(e);});
  });}
  function poll(){if(busy||document.hidden)return;busy=true;
    request().then(function(j){last=j;try{localStorage.setItem('tvhome.todo.cache',JSON.stringify({key:key,data:j}));}catch(e){}window.TV_HOME_NOTES_RENDER(j);}).catch(function(){window.TV_HOME_NOTES_RENDER(last?Object.assign({},last,{stale:true}):{tasks:[],unavailable:true});}).then(function(){busy=false;});
  }
  poll();setInterval(poll,15000);addEventListener('visibilitychange',function(){if(!document.hidden)poll();});
}());
