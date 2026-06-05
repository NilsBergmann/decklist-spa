import json
from pathlib import Path
from typing import DefaultDict

from jinja2 import Template

from data.deck import Card, Color, COLOR_TO_HEX, Deck, Rarity, RARITY_TO_HEX
from output.cardconjurer.watermarks import WATERMARKS

# Define desired sort order
TYPE_SORT_ORDER = [
    "Creature",
    "Instant",
    "Sorcery",
    "Artifact",
    "Enchantment",
    "Land",
    "Token",
]

IGNORED_TYPES = ["Other"]


def printDecks(decks: list[Deck], templatePath=None, watermark=None) -> list[dict]:
    if templatePath is None:
        templatePath = Path(__file__).parent / "template.json.j2"

    return [printDeck(deck, templatePath, watermark) for deck in decks]


def printDeck(deck: Deck, templatePath=None, watermark=None) -> dict:
    if templatePath is None:
        templatePath = Path(__file__).parent / "template.json.j2"

    with open(templatePath) as f:
        template = Template(f.read())
        colorPairs = sorted(
            deck.getColors().items(), key=lambda item: item[1], reverse=True
        )
        primaryColor = (
            colorPairs[0][0] if 1 <= len(colorPairs) <= 2 else Color.MULTI_COLOR
        )
        secondaryColor = colorPairs[1][0] if len(colorPairs) == 2 else primaryColor

        key = watermark or "none"
        watermarkData = WATERMARKS[key]

        rendered = template.render(
            Name="DECKLIST: " + deck.name,
            Title=renderTitle(deck),
            Text=renderText(deck),
            primaryColor=primaryColor.lower(),
            secondaryColor=secondaryColor.lower(),
            primaryColorHex=COLOR_TO_HEX[primaryColor],
            secondaryColorHex=COLOR_TO_HEX[secondaryColor],
            watermarkSource=watermarkData.image,
            watermarkX=watermarkData.x,
            watermarkY=watermarkData.y,
            watermarkZoom=watermarkData.zoom,
        )
        output: dict = json.loads(rendered)
        return output


def renderTitle(deck: Deck) -> str:
    return "{bold}" + deck.name + "{/bold}"


def renderText(deck: Deck) -> str:
    text = ""
    typeGroups = groupCardsByType(deck)
    typeGroups = dict(
        sorted(
            typeGroups.items(),
            key=lambda item: (
                TYPE_SORT_ORDER.index(item[0]) if item[0] in TYPE_SORT_ORDER else 99
            ),
        )
    )
    for type, cards in typeGroups.items():
        if type in IGNORED_TYPES:
            continue
        text += renderTypeHeader(type, len(cards)) + "\\n"
        for card, count in groupDuplicates(cards):
            text += renderCard(card, count) + "\\n"
    text = text.rstrip("\\n")
    return text


def groupDuplicates(cards: list[Card]) -> list[tuple[Card, int]]:
    cardMap: dict[str, tuple[Card, int]] = {}
    for card in cards:
        if card.name not in cardMap:
            cardMap[card.name] = (card, 1)
        else:
            existingCard, count = cardMap[card.name]
            cardMap[card.name] = (existingCard, count + 1)
    retVal = list(cardMap.values())
    retVal.sort(key=lambda item: Rarity._ORDER.index(item[0].rarity))
    return retVal


def groupCardsByType(deck: Deck) -> dict[str, list[Card]]:
    groups: dict[str, list[Card]] = DefaultDict(list)
    for card in deck.cards:
        type = card.type
        groups[type].append(card)
    return groups


def renderCard(card: Card, count: int) -> str:
    rarityHex = RARITY_TO_HEX[card.rarity]
    return (
        "{right10}"
        + f"{str(count)+"x" if count > 1 else "    "}"
        + f"{{fontcolor{rarityHex}}} ◆ {{fontcolor#000000}}"
        + f"{card.name} {card.cost}"
    )


def renderTypeHeader(name: str, count: int) -> str:
    return "{bold}" + name + f" ({count})" + "{/bold}"
