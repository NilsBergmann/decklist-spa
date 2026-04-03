from collections import defaultdict
from typing import DefaultDict, List, Set

import requests

from data.deck import Card, Color, Deck, Rarity
from input.cubecobra.models import MainboardItem, Model

IGNORED_TAGS = ["Token", "Y Token", "Z Theme"]


def getCubeData(cubeID: str) -> Model:
    URL = f"https://cubecobra.com/cube/api/cubeJSON/{cubeID}"
    response = requests.get(URL)
    jsonData: dict = response.json()
    model: Model = Model.model_validate(jsonData)
    return model


def convertCubeDataToDeck(model: Model) -> List[Deck]:
    # Filter duplicates
    filtered_mainboard: List[MainboardItem] = []
    seen_indexes: Set[int] = set()
    for card in model.cards.mainboard:
        idx = card.index
        if idx not in seen_indexes:
            seen_indexes.add(idx)
            filtered_mainboard.append(card)

    # Group by Tags
    cardsByTag: DefaultDict[str, List[MainboardItem]] = defaultdict(list)
    for card in filtered_mainboard:
        for tag in card.tags:
            if tag not in IGNORED_TAGS:
                cardsByTag[tag].append(card)

    print(f"Tags found: {list(cardsByTag.keys())}")

    decks = [convertTagToDeck(tag, cards) for tag, cards in cardsByTag.items()]
    return decks


def convertTagToDeck(tag: str, cards: List[MainboardItem]) -> Deck:
    cardz = [convertMainboardItemToCard(card) for card in cards]
    deck = Deck(name=tag, cards=cardz)
    return deck


def convertMainboardItemToCard(card: MainboardItem) -> Card:
    details = card.details
    try:
        colors = [Color(color) for color in details.colors]
    except ValueError as e:
        print(f"Error converting colors for {details.name}: {details.colors} - {e}")
        colors = []

    return Card(
        name=details.name,
        rarity=Rarity(details.rarity),
        type=simplifyCardType(details.type),
        cost=format_cost(details.parsed_cost),
        color=colors,
        cmc=details.cmc,
    )


def format_cost(cost: list[str]) -> str:
    cost.sort()
    return "".join(f"{{{c.replace('-', '')}}}" for c in cost)


def simplifyCardType(cardType: str) -> str:
    newType = cardType.split(" — ")[0].removeprefix("Legendary ").removeprefix("Basic ")
    if newType == "Card":
        newType = "Other"
    if "Token" in newType:
        return "Token"
    elif "Creature" in newType:
        return "Creature"
    return newType
