import json

from input.cubecobra.cubecobra import getCubeData
from output.cardconjurer.cardconjurer import printDecks
from input.cubecobra.cubecobra import convertCubeDataToDeck


# cubeID = "blb-tight"
# watermark = "blb"
# cubeID = "eoe-tight"
# watermark = "eoe"
cubeID = "tla-tle-tight"
watermark = "tla"
data = getCubeData(cubeID)
print(data)

decks = convertCubeDataToDeck(data)
print(decks)

result = printDecks(decks, watermark=watermark)
print(result)

filename = cubeID + ".cardconjurer"
with open(filename, "w") as f:
    json.dump(result, f, indent=2)

print("\n\nDONE! Output written to " + filename)
