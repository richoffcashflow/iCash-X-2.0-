import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {test} from 'node:test';
import ts from 'typescript';

const require=createRequire(import.meta.url);
const source=ts.transpileModule(readFileSync(new URL('../components/webinar-express-checkout.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
const all=node=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(all):[node,...all(node.props?.children)];
const text=node=>typeof node==='string'?node:Array.isArray(node)?node.map(text).join(' '):node&&typeof node==='object'?text(node.props?.children):'';
function harness(props={}){
 const state=[];let cursor=0;
 const module={exports:{}};
 const mocks={react:{useState:initial=>{const index=cursor++;if(!(index in state))state[index]=initial;return [state[index],next=>{state[index]=next;}];}},'next/image':{__esModule:true,default:'Image'},'@/components/account-access':{AccountAccess:'AccountAccess'},'@/components/funding-dialog':{FundingDialog:'FundingDialog'},'@/components/membership-checkout':{MembershipCheckout:'MembershipCheckout'},'@/components/plan-workspace-preview':{PlanWorkspacePreview:'PlanWorkspacePreview'},'@/lib/webinar-site':{webinarSite:{workspacePath:'/',supportPath:'/support'}}};
 new Function('require','module','exports',source)(name=>name.endsWith('.css')?{}:mocks[name]??require(name),module,module.exports);
 return ()=>{cursor=0;return module.exports.WebinarExpressCheckout(props);};
}
const find=(tree,type)=>all(tree).find(node=>node.type===type);

test('checkout header exposes the existing brand and sign-in dialog without replacing checkout',()=>{
 const render=harness();let tree=render();
 assert.equal(find(tree,'Image').props.src,'/icash-x-logo.png');
 assert.equal(find(tree,'Image').props.alt,'iCash X');
 assert.equal(all(tree).find(node=>node.props?.['aria-label']==='iCash X home').props.href,'/');
 assert.equal(find(tree,'MembershipCheckout').props.embedded,true);
 assert.equal(find(tree,'MembershipCheckout').props.presentation,'plan');
 assert.equal(find(tree,'AccountAccess'),undefined);
 const signIn=all(tree).find(node=>node.type==='button'&&text(node)==='Sign in');
 assert.equal(signIn.props['aria-haspopup'],'dialog');signIn.props.onClick();tree=render();
 assert.equal(find(tree,'FundingDialog').props.title,'Welcome back');
 assert.equal(find(tree,'AccountAccess').props.ready,true);
 assert.ok(find(tree,'MembershipCheckout'),'opening sign-in preserves any checkout progress');
 find(tree,'FundingDialog').props.onClose();assert.equal(find(render(),'AccountAccess'),undefined);
});

test('home sign-in and post-purchase setup refresh the account using the same callback',()=>{
 let refreshed=0;const render=harness({onSignedIn:()=>refreshed++});
 let tree=render();find(tree,'button').props.onClick();tree=render();find(tree,'AccountAccess').props.onSignedIn();
 assert.equal(refreshed,1);assert.equal(find(render(),'FundingDialog'),undefined);
 find(render(),'MembershipCheckout').props.onSignedIn();assert.equal(refreshed,2);
});

test('standalone express checkout returns verified customers to the workspace',()=>{
 const previous=globalThis.window,redirects=[];
 try{globalThis.window={location:{assign:path=>redirects.push(path)}};
  const render=harness();find(render(),'MembershipCheckout').props.onSignedIn();
  find(render(),'button').props.onClick();find(render(),'AccountAccess').props.onSignedIn();
  assert.deepEqual(redirects,['/','/']);
 }finally{if(previous===undefined)delete globalThis.window;else globalThis.window=previous;}
});

test('homepage account loading and retry never mount the purchase form prematurely',()=>{
 let retried=0;const props={checkingAccount:true,accountError:false,onRetry:()=>retried++};const render=harness(props);
 assert.equal(find(render(),'MembershipCheckout'),undefined);assert.match(text(render()),/Getting everything ready/);
 props.accountError=true;let tree=render();assert.equal(find(tree,'MembershipCheckout'),undefined);
 assert.match(text(tree),/couldn’t load your account/);
 all(tree).find(node=>node.type==='button'&&text(node)==='Try again').props.onClick();assert.equal(retried,1);
 props.checkingAccount=false;props.accountError=false;assert.ok(find(render(),'MembershipCheckout'));
});

test('email sign-in availability follows the account service',()=>{
 const render=harness({signInReady:false});find(render(),'button').props.onClick();assert.equal(find(render(),'AccountAccess').props.ready,false);
});

test('engaged checkout keeps the same component position while simplifying its surrounding layout',()=>{
 const render=harness();let tree=render();
 const lineage=(node,type,path=[])=>!node||typeof node!=='object'?null:Array.isArray(node)?node.map((child,index)=>lineage(child,type,[...path,index])).find(Boolean):node.type===type?path:lineage(node.props?.children,type,[...path,node.type]);
 const before=lineage(tree,'MembershipCheckout');
 find(tree,'MembershipCheckout').props.onEngaged();tree=render();
 assert.deepEqual(lineage(tree,'MembershipCheckout'),before,'payment form must not remount when checkout begins');
 assert.equal(all(tree).find(node=>node.props?.className==='wb-plan-layout').props['data-engaged'],true);
 assert.equal(find(tree,'FundingDialog'),undefined,'engagement does not open sign-in');
});
