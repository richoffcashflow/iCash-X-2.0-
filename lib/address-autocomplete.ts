export interface AddressPrediction {
  placeId: string;
  text: {toString(): string};
  toPlace(): {formattedAddress?: string | null; fetchFields(options: {fields: string[]}): Promise<unknown>};
}

export interface PlacesLibrary {
  AutocompleteSessionToken: new () => object;
  AutocompleteSuggestion: {
    fetchAutocompleteSuggestions(request: {input: string; sessionToken: object; includedRegionCodes: string[]; language: string}): Promise<{suggestions: {placePrediction?: AddressPrediction | null}[]}>;
  };
}

// Keep one billing session per search; selecting a place ends that session.
export function createAddressSearch(places: PlacesLibrary) {
  let token: object | undefined;
  return {
    async search(input: string) {
      if (input.trim().length < 3) return [];
      token ??= new places.AutocompleteSessionToken();
      const result = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input: input.trim(), sessionToken: token, includedRegionCodes: ['us'], language: 'en-US',
      });
      return result.suggestions.flatMap(item => item.placePrediction ? [item.placePrediction] : []).slice(0, 5);
    },
    async select(prediction: AddressPrediction) {
      token = undefined;
      const place = prediction.toPlace();
      await place.fetchFields({fields: ['formattedAddress']});
      return place.formattedAddress || prediction.text.toString();
    },
  };
}
