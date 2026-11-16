/** Warm the existing public media host while session authorization runs.
 * No video is selected or fetched before its saved session is returned. */
export function WebinarMediaConnection(){
 try{
  const url=new URL(process.env.SUPABASE_URL??'');
  if(url.protocol!=='https:')return null;
  return <link rel="preconnect" href={url.origin}/>;
 }catch{return null;}
}
