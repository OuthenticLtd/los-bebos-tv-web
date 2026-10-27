(function(){
  var key='';try{var fragment=new URLSearchParams(location.hash.slice(1));key=fragment.get('tvnotes')||localStorage.getItem('tvhome.todo.key')||'';if(key){localStorage.setItem('tvhome.todo.key',key);history.replaceState(null,'',location.pathname+location.search);}}catch(e){}
  if(!key||!window.TV_HOME_NOTES_RENDER)return;
  var endpoint='https://anitka-macbook.tailc505f3.ts.net/tv-notes',busy=false,last=null;
  window.TV_HOME_NOTES_RENDER({tasks:[],loading:true});
  function poll(){if(busy||document.hidden)return;busy=true;var controller=window.AbortController?new AbortController():null;var timer=setTimeout(function(){if(controller)controller.abort();},12000);
    fetch(endpoint,{cache:'no-store',headers:{'X-TV-Notes-Key':key},signal:controller?controller.signal:undefined}).then(function(r){if(!r.ok)throw Error('Notes unavailable');return r.json();}).then(function(j){last=j;window.TV_HOME_NOTES_RENDER(j);}).catch(function(){window.TV_HOME_NOTES_RENDER(last?Object.assign({},last,{stale:true}):{tasks:[],unavailable:true});}).then(function(){clearTimeout(timer);busy=false;});
  }
  poll();setInterval(poll,15000);addEventListener('visibilitychange',function(){if(!document.hidden)poll();});
}());
