'use client';
import {useState} from 'react';
import {WorkspacePanel} from './workspace-panel';

function SamplePanel({broken}:{broken:boolean}){
 if(broken)throw Error('Intentional workspace recovery fixture');
 return <p>Sample panel opened. Your other work is still here.</p>;
}
/** Mounted only by the preview's explicit recovery fixture query; never a customer control. */
export function WorkspaceRecoveryPreview(){
 const [broken,setBroken]=useState(false);
 return <section aria-label="Recovery example" className="workspace-preview-banner"><div><strong>Sample recovery check</strong><p>Fictional failure. No account work is changed.</p><button type="button" className="workspace-quiet" onClick={()=>setBroken(true)}>Break sample panel</button><button type="button" className="workspace-quiet" onClick={()=>setBroken(false)}>Restore sample panel</button><WorkspacePanel title="Recovery example" label="Open recovery example" section="property"><SamplePanel broken={broken}/></WorkspacePanel></div></section>;
}
