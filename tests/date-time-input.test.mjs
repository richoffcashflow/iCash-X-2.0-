import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {joinLocalDateTime,splitLocalDateTime} from '../lib/date-time-input.ts';

// Midnight/noon must keep the same date and map back to the original local deadline.
for(const [local,hour,period] of [['2026-10-07T00:15','12','AM'],['2026-10-07T12:15','12','PM'],['2026-10-07T23:59','11','PM'],['2026-10-07T06:00','6','AM']]){
 const parts=splitLocalDateTime(local);assert.equal(parts.hour,hour);assert.equal(parts.period,period);assert.equal(joinLocalDateTime(parts),local);
}
let cells=[],effects=[],pending=[],index=0;
const listeners=new Map(),form={addEventListener:(key,fn)=>listeners.set(key,fn),removeEventListener:key=>listeners.delete(key)};
const jsx=(type,props)=>{if(type==='input'&&props.type==='hidden'&&props.ref)props.ref.current={form};return {type,props};};
const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
const deps={joinLocalDateTime,splitLocalDateTime,_jsx:jsx,_jsxs:jsx,useState(initial){const n=index++;if(!(n in cells))cells[n]=typeof initial==='function'?initial():initial;return [cells[n],value=>cells[n]=typeof value==='function'?value(cells[n]):value];},useRef(initial){return cells[index++]??={current:initial};},useEffect(fn,list){const n=index++;if(!same(effects[n]?.list,list))pending.push(()=>{effects[n]?.cleanup?.();effects[n]={list,cleanup:fn()};});}};
globalThis.__ampmInput=deps;
const source=ts.transpileModule(readFileSync(new URL('../components/date-time-input.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/^import .*;\s*$/gm,'');
const {DateTimeInput}=await import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(deps).join(',')+'}=globalThis.__ampmInput;\n'+source).toString('base64'));
const all=node=>!node||typeof node!=='object'?[]:[node,...[node.props?.children].flat(Infinity).flatMap(all)];
const render=props=>{index=0;const node=DateTimeInput(props);while(pending.length)pending.shift()();return node;};
let value='',props={label:'Deadline',name:'deadline',required:true,value,onChange:e=>{value=e.target.value;props={...props,value};}};
let tree=render(props);
const control=(label)=>all(tree).find(n=>n.props?.['aria-label']===label);
control('Deadline hour').props.onChange({target:{value:'6'}});tree=render(props);
assert.equal(control('Deadline hour').props.value,'6','Time can be chosen before the date');
control('Deadline date').props.onChange({target:{value:'2026-10-07'}});tree=render(props);assert.equal(value,'2026-10-07T18:00');
control('Deadline AM or PM').props.onChange({target:{value:'AM'}});tree=render(props);assert.equal(value,'2026-10-07T06:00');
assert.equal(all(tree).find(n=>n.props?.type==='hidden').props.value,value);assert.equal(control('Deadline date').props.required,true);
props={...props,value:'2026-10-08T00:30'};render(props);tree=render(props);assert.equal(control('Deadline hour').props.value,'12');assert.equal(control('Deadline AM or PM').props.value,'AM');
control('Deadline date').props.onChange({target:{value:''}});tree=render(props);assert.equal(value,'','Clearing an optional deadline does not retain its old timestamp');
effects.forEach(e=>e?.cleanup?.());cells=[];effects=[];pending=[];
props={label:'Evidence time',name:'observedAt',required:true};tree=render(props);
all(tree).find(n=>n.props?.type==='date').props.onChange({target:{value:'2026-10-07'}});tree=render(props);assert.equal(all(tree).find(n=>n.props?.type==='hidden').props.value,'2026-10-07T12:00');
listeners.get('reset')();tree=render(props);assert.equal(all(tree).find(n=>n.props?.type==='hidden').props.value,'','A successful form reset also clears the serialized timestamp');
assert.ok(!all(tree).some(n=>['time','datetime-local'].includes(n.props?.type)));
effects.forEach(e=>e?.cleanup?.());
console.log('PASS AM/PM inputs: noon/midnight, date preservation, partial edits, controlled reload, required date, form submission value and reset.');
