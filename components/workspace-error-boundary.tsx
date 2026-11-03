'use client';
import {Component,type ReactNode} from 'react';
import {recordWorkspaceExperience,type WorkspaceExperienceStage} from '@/lib/workspace-experience-client';

/** A broken optional panel must not take away the rest of the workspace. */
export class WorkspaceErrorBoundary extends Component<{telemetry?:boolean;children:ReactNode;stage:WorkspaceExperienceStage},{failed:boolean}>{
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true};}
 componentDidCatch(){if(this.props.telemetry!==false)recordWorkspaceExperience({event:'panel_error',stage:this.props.stage});}
 retry=()=>{if(this.props.telemetry!==false)recordWorkspaceExperience({event:'panel_retry',stage:this.props.stage});this.setState({failed:false});};
 render(){
  if(this.state.failed)return <section className="workspace-panel-recovery"><button type="button" className="workspace-quiet" aria-label="Refresh section" onClick={this.retry}>Refresh</button></section>;
  return this.props.children;
 }
}
