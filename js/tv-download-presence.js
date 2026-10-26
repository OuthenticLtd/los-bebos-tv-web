(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.TV_DOWNLOAD_PRESENCE=factory();}(this,function(){
  function verify(entries, options, callback) {
    var rows=entries.map(function(e){var r={};Object.keys(e).forEach(function(k){r[k]=e[k];});if(r.state==='done')r.present=false;return r;}),pending=1,finished=false;
    var later=options.setTimeout||setTimeout,clear=options.clearTimeout||clearTimeout;
    var timer=later(finish,options.timeoutMs||2000);
    function finish(){if(finished)return;finished=true;clear(timer);callback(rows);}
    function complete(){if(--pending===0)finish();}
    rows.forEach(function(row){if(row.state!=='done')return;pending++;var replied=false;
      function reply(file){if(replied||finished)return;replied=true;row.present=!!(file&&file.isFile===true&&Number(file.fileSize)>0&&(!row.total||Number(file.fileSize)>=Number(row.total)));row.verifiedAt=Date.now();complete();}
      try { var path=options.pathFor(row);if(!path)return reply(null);options.resolve(path,reply,function(){reply(null);}); }catch(e){reply(null);}
    });complete();
  }
  return {verify:verify};
}));
