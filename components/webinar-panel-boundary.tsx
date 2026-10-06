'use client';
import {Component,type ReactNode} from 'react';

/** Optional panels must never unmount the playing video when rendering fails. */
export class WebinarPanelBoundary extends Component<{children:ReactNode;label?:string;quiet?:boolean;fallbackHref?:string}, {failed:boolean}>{
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true};}
 render(){
  if(!this.state.failed)return this.props.children;
  if(this.props.quiet)return null;
  return <section className="wb-panel-recovery" role="alert"><p>{this.props.label||'This panel'} could not load.</p><button type="button" onClick={()=>this.setState({failed:false})}>Try again</button>{this.props.fallbackHref&&<a href={this.props.fallbackHref}>Continue to checkout</a>}<a href="/support">Get help</a></section>;
 }
}
