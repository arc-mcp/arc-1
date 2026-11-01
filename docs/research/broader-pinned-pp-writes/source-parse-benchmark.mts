import {performance} from 'node:perf_hooks';
import {spliceUnit} from '../../../src/context/unit-surgery.ts';
import {runPreWriteLint} from '../../../src/handlers/write-helpers.ts';
import {DEFAULT_CONFIG} from '../../../src/server/types.ts';
for(const count of [100,1000,5000]){
 const source='REPORT zbench.\n'+Array.from({length:count},(_,i)=>`FORM unit${i}.\nDATA value TYPE i.\nvalue = 1.\nENDFORM.\n`).join('');
 const began=performance.now();const edit=spliceUnit(source,'ZBENCH','unit0','FORM unit0.\nDATA value TYPE i.\nvalue = 2.\nENDFORM.');const spliceMs=performance.now()-began;
 if(!edit.success)throw Error(edit.error);
 const lintStart=performance.now();const lint=runPreWriteLint(edit.newSource,'PROG','ZBENCH',{...DEFAULT_CONFIG,abapRelease:'758',lintBeforeWrite:true});
 console.log(JSON.stringify({count,bytes:Buffer.byteLength(source),spliceMs:Math.round(spliceMs),lintMs:Math.round(performance.now()-lintStart),lintBlocked:lint.blocked,rssBytes:process.memoryUsage().rss,node:process.version}));
}
