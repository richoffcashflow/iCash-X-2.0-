/** Research shortlist, not a verified top-50 ranking. No ZIP, channel or paid-work approval is implied. */
export const launchMarketCandidates=[
 ['dallas_fort_worth','Dallas-Fort Worth','TX'],['houston','Houston','TX'],['san_antonio','San Antonio','TX'],['austin','Austin','TX'],['el_paso','El Paso','TX'],
 ['atlanta','Atlanta','GA'],['savannah','Savannah','GA'],['augusta','Augusta','GA-SC'],['charlotte','Charlotte','NC-SC'],['raleigh','Raleigh','NC'],
 ['greensboro','Greensboro','NC'],['winston_salem','Winston-Salem','NC'],['fayetteville_nc','Fayetteville','NC'],['greenville_sc','Greenville','SC'],['columbia_sc','Columbia','SC'],
 ['charleston','Charleston','SC'],['jacksonville','Jacksonville','FL'],['tampa','Tampa','FL'],['orlando','Orlando','FL'],['lakeland','Lakeland','FL'],
 ['ocala','Ocala','FL'],['miami','Miami-Fort Lauderdale','FL'],['phoenix','Phoenix','AZ'],['tucson','Tucson','AZ'],['las_vegas','Las Vegas','NV'],
 ['indianapolis','Indianapolis','IN'],['columbus','Columbus','OH'],['cincinnati','Cincinnati','OH-KY-IN'],['cleveland','Cleveland','OH'],['dayton','Dayton','OH'],
 ['detroit','Detroit','MI'],['grand_rapids','Grand Rapids','MI'],['st_louis','St. Louis','MO-IL'],['kansas_city','Kansas City','MO-KS'],['memphis','Memphis','TN-MS-AR'],
 ['nashville','Nashville','TN'],['knoxville','Knoxville','TN'],['chattanooga','Chattanooga','TN-GA'],['birmingham','Birmingham','AL'],['huntsville','Huntsville','AL'],
 ['montgomery','Montgomery','AL'],['oklahoma_city','Oklahoma City','OK'],['tulsa','Tulsa','OK'],['little_rock','Little Rock','AR'],['baton_rouge','Baton Rouge','LA'],
 ['new_orleans','New Orleans','LA'],['louisville','Louisville','KY-IN'],['richmond','Richmond','VA'],['hampton_roads','Virginia Beach-Norfolk','VA-NC'],['baltimore','Baltimore','MD']
].map(([id,name,states])=>({id,name,states:states.split('-'),status:'research_required' as const,enabled:false as const}));
