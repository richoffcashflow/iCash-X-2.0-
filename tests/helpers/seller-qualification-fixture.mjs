export const qualifiedSellerTurns=[
 ['Is this the owner of 45 Fixture Lane?','Yes, I am the owner.'],
 ["I'm with Fixture buyer about your cash-offer request. Is now a good time?",'Yes.'],
 ['Are you looking to sell the property?','Yes.'],
 ['What has you thinking about selling?','I am moving and do not want to keep the house.'],
 ['What repairs or updates does it need?','It needs a new roof and some paint.'],
 ['Is anyone living in the property?','No, it is vacant.'],
 ['When would you ideally like to sell?','In the next 30 days.'],
 ['Is it currently listed with a real estate agent?','No.'],
].flatMap(([question,answer])=>[{role:'agent',message:question},{role:'user',message:answer}]);
