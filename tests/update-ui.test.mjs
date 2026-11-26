import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function surface(release,project={name:'Agy Powertools'}){
  const states=[],effects=[],calls=[];let index=0,status={status:'idle'};
  const React={createElement:(type,props,...children)=>({type,props:props||{},children}),Fragment:'fragment',useState:initial=>{const n=index++;if(!(n in states))states[n]=initial;return[states[n],value=>{states[n]=value;}];},useEffect:effect=>effects.push(effect)};
  const context=vm.createContext({React,document:{createElement:()=>({dataset:{},remove(){}}),head:{append(){}}},URL,setInterval:()=>1,clearInterval(){},UP:'row',TP:'card',VP:'section',Uy:'button',k0:'disclosure',dq:'icon'});
  vm.runInContext(readFileSync(new URL('../lib/native-panels.js',import.meta.url),'utf8'),context);
  const panels=context.__agyPanels({version:'2.12.0',project,t:value=>value,options:()=>({language:'en'}),request:async(method,payload)=>{calls.push({method,payload});if(method==='update.check')return release;if(method==='update.install')return{status:'preparing',version:release.version};return status;}});
  const render=()=>{index=0;return panels.About();};
  function find(node,id){if(!node||typeof node!=='object')return null;if(node.props?.['data-testid']===id)return node;for(const value of [...node.children||[],node.props?.label,node.props?.description,node.props?.rightElement]){const values=Array.isArray(value)?value:[value];for(const item of values){const found=find(item,id);if(found)return found;}}return null;}
  function collectText(node){if(node==null||typeof node==='boolean')return '';if(typeof node==='string'||typeof node==='number')return String(node);if(Array.isArray(node))return node.map(collectText).join('');if(typeof node==='object')return collectText(node.children);return '';}
  return{calls,render,find,collectText,effects,setStatus:value=>{status=value;}};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('About renders a unified single row with linked project name, version badge, subscription, and check button',()=>{
  const project={name:'Agy Powertools',githubUrl:'https://github.com/WhiteBr1ck/agy-powertools',subscriptionUrl:'https://example.com/subscribe'};
  const ui=surface(null,project),tree=ui.render(),card=tree.children[0],rows=card.children;
  assert.equal(rows.filter(row=>row?.type==='row').length,1);
  const anchor=ui.find(tree,'agy-project-link');
  assert.equal(anchor.type,'a');assert.equal(anchor.children[0],project.name);
  assert.equal(anchor.props.href,project.githubUrl);assert.equal(anchor.props.target,'_blank');assert.equal(anchor.props.rel,'noopener noreferrer');
  assert.equal(ui.find(rows[0],'agy-about-version').children[0],'2.12.0');
  assert.equal(ui.find(rows[0],'agy-subscription-link').props.href,project.subscriptionUrl);
  assert.ok(ui.find(rows[0],'agy-check-update'));
});

test('About shows plain project text and hides subscription when links are missing or unsafe',()=>{
  for(const url of [undefined,'','javascript:alert(1)','data:text/html,test','https://user:secret@example.com/']){
    const ui=surface(null,{name:'Agy Powertools',githubUrl:url,subscriptionUrl:url}),tree=ui.render();
    assert.equal(ui.find(tree,'agy-project-link'),null);
    const name=ui.find(tree,'agy-project-name');assert.equal(name.type,'span');assert.equal(name.children[0],'Agy Powertools');assert.equal(name.props.href,undefined);
    assert.equal(ui.find(tree,'agy-subscription-link'),null);
  }
});

test('About morphs the single action button through check, install, progress, rollback, and completion',async()=>{
  const ui=surface({status:'available',version:'2.13.0',canInstall:true,releaseUrl:'https://github.com/test/project/releases/tag/v2.13.0'});
  ui.find(ui.render(),'agy-check-update').props.onClick();await tick();let tree=ui.render();
  assert.equal(ui.find(tree,'agy-check-update'),null);
  const installBtn=ui.find(tree,'agy-install-update');
  assert.ok(installBtn);
  assert.ok(ui.collectText(installBtn).includes('2.13.0'));
  installBtn.props.onClick();await tick();tree=ui.render();
  assert.equal(ui.find(tree,'agy-install-update').props.disabled,true);
  assert.deepEqual(ui.calls.find(call=>call.method==='update.install').payload.version,'2.13.0');
  assert.ok(ui.collectText(ui.find(tree,'agy-install-status')).includes('Preparing update…'));
  ui.setStatus({status:'rolled-back'});ui.effects[0]();await tick();tree=ui.render();
  assert.ok(ui.collectText(ui.find(tree,'agy-install-status')).includes('Update failed. Previous version restored.'));
  assert.equal(ui.find(tree,'agy-install-update').props.disabled,false);
  ui.setStatus({status:'completed'});ui.effects[0]();await tick();tree=ui.render();
  assert.ok(ui.collectText(ui.find(tree,'agy-install-status')).includes('Update installed'));
  assert.equal(ui.find(tree,'agy-install-update').props.disabled,true);
});

test('releases without an installable package morph into a download link without an install button',async()=>{
  const ui=surface({status:'available',version:'2.13.0',canInstall:false,releaseUrl:'https://github.com/test/project/releases/tag/v2.13.0'});
  ui.find(ui.render(),'agy-check-update').props.onClick();await tick();const tree=ui.render();
  assert.equal(ui.find(tree,'agy-install-update'),null);
  assert.equal(ui.find(tree,'agy-check-update'),null);
  assert.ok(ui.find(tree,'agy-update-download'));
  assert.equal(ui.calls.some(call=>call.method==='update.install'),false);
});

test('About renders GitHub release notes Markdown safely without raw syntax or unsafe links',async()=>{
  const md=[
    '## 中文说明',
    '- **新增功能**：支持 `v2.13.7` [查看详情](https://github.com/WhiteBr1ck/agy-powertools)',
    '  - 嵌套子项与 [恶意链接](javascript:alert(1))'
  ].join('\n');
  const ui=surface({status:'available',version:'2.13.8',canInstall:true,notes:md,releaseUrl:'https://github.com/WhiteBr1ck/agy-powertools/releases/tag/v2.13.8'});
  ui.find(ui.render(),'agy-check-update').props.onClick();await tick();
  const tree=ui.render();
  const body=ui.find(tree,'agy-release-notes-body');
  assert.ok(body);
  const walk=(node,fn)=>{if(!node||typeof node!=='object')return;fn(node);for(const c of [].concat(node.children||[]))walk(c,fn);};
  const tags=[],links=[],codes=[],strongs=[];
  walk(body,n=>{
    if(typeof n.type==='string')tags.push(n.type);
    if(n.type==='a')links.push(n.props.href);
    if(n.type==='code')codes.push(n.children[0]);
    if(n.type==='strong')strongs.push(n.children[0]);
  });
  assert.ok(tags.includes('h4'));
  assert.ok(tags.includes('ul'));
  assert.deepEqual(strongs,['新增功能']);
  assert.deepEqual(codes,['v2.13.7']);
  assert.deepEqual(links,['https://github.com/WhiteBr1ck/agy-powertools']);
});

test('About resets stale completed update state when running version is already >= completed version (Issue #47)', async () => {
  const ui = surface({ status: 'current', version: '2.12.0' });
  ui.setStatus({ status: 'completed', version: '2.12.0' });
  ui.render();
  ui.effects[0]();
  await tick();
  const tree = ui.render();
  assert.ok(ui.find(tree, 'agy-check-update'));
  assert.equal(ui.find(tree, 'agy-install-update'), null);
});
