#!/usr/bin/env python3
"""Fold marker titles into a small, speakable vocabulary.

Markers are named by whoever tagged the scene, and after thousands of them the
library says "Blowjob" 1325 times, "blowjob" 353 and "Blow Job" 255 — three
pills for one act. This rewrites titles onto one canonical name each, using the
same vocabulary the tag sheet uses where they overlap.

    ./marker-names.py --port 9998 --dry-run     # print the mapping
    ./marker-names.py --port 9998 --apply       # rewrite titles in Stash
"""
import json
import re
import sys
import urllib.request

CANON = {
    # --- positions & acts ---------------------------------------------------
    "doggy": "Doggy Style", "doggy style": "Doggy Style", "doggystyle": "Doggy Style",
    "doggy-style": "Doggy Style", "doggy style - squatting": "Doggy Style",
    "cowgirl - squatting": "Cowgirl", "table lotus - mixed": "Table Lotus",
    "lickey - pussy": "Pussy Eating", "licking - pussy": "Pussy Eating",
    "sidefuck": "Side Fuck", "missionary - mixed": "Missionary",
    "standing doggystyle": "Doggy Style", "standing doggy": "Doggy Style",
    "doggystyle - standing": "Doggy Style", "sideview doggystyle": "Doggy Style",
    "side view doggystyle": "Doggy Style", "side doggy": "Doggy Style",
    "lazy doggy": "Doggy Style", "flat doggystyle": "Doggy Style",
    "frontview doggystyle": "Doggy Style", "pov doggystyle": "Doggy Style",
    "doggystyle - pov": "Doggy Style", "doggystyle - lying": "Doggy Style",
    "anal doggystyle": "Anal", "anal doggy": "Anal", "best doggy": "Doggy Style",
    "foot on head doggy": "Doggy Style",
    "missionary": "Missionary", "missonary": "Missionary",
    "sideview missionary": "Missionary", "side view missionary": "Missionary",
    "side missionary": "Missionary", "missionary sideview": "Missionary",
    "legs up missionary": "Missionary", "missionary - legs up": "Missionary",
    "missionary close": "Missionary", "pov missionary": "Missionary",
    "missionary - pov": "Missionary", "standing missionary": "Missionary",
    "anal missionary": "Anal", "side anal missionary": "Anal",
    "cowgirl": "Cowgirl", "cowgirl - pov": "Cowgirl", "cowgirl pov": "Cowgirl",
    "squatting cowgirl": "Cowgirl", "seated cowgirl": "Cowgirl",
    "laying cowgirl": "Cowgirl", "sideview cowgirl": "Cowgirl",
    "anal cowgirl": "Anal", "she's riding cowgirl": "Cowgirl",
    "reverse cowgirl": "Reverse Cowgirl", "revcowgirl": "Reverse Cowgirl",
    "rverese cowgirl": "Reverse Cowgirl", "reverse girl": "Reverse Cowgirl",
    "rearview cowgirl": "Reverse Cowgirl", "seated reverse cowgirl": "Reverse Cowgirl",
    "laying reverse cowgirl": "Reverse Cowgirl", "frontview reverse cowgirl": "Reverse Cowgirl",
    "squatting reverse cowgirl": "Reverse Cowgirl",
    "blowjob": "Blowjob", "blow job": "Blowjob", "blowjobs": "Blowjob", "bj": "Blowjob",
    "head": "Blowjob", "standing blowjob": "Blowjob", "sitting blowjob": "Blowjob",
    "sideview blowjob": "Blowjob", "blowjob from behind": "Blowjob",
    "ass view blowjob": "Blowjob", "blowjob - pov": "Blowjob",
    "double blowjob": "Double Blowjob", "double blow jobs": "Double Blowjob",
    "blowjob - double": "Double Blowjob", "blowjob - threeway": "Double Blowjob",
    "missionary blowjob": "Blowjob", "blowjob/handjob combo": "Blowjob",
    "deepthroat": "Deepthroat", "deep throat": "Deepthroat",
    "deepthroating": "Deepthroat", "deepthroat - pov": "Deepthroat",
    "handjob": "Handjob", "hand job": "Handjob", "handjob - pov": "Handjob",
    "footjob": "Footjob", "foot job": "Footjob", "thigh job": "Thigh Job",
    "titfuck": "Titfuck", "tit fuck": "Titfuck", "titty fuck": "Titfuck",
    "tittyfuck": "Titfuck", "titty fucking": "Titfuck", "tits fucking": "Titfuck",
    "tit wank": "Titfuck", "tit job": "Titfuck", "titjob": "Titfuck",
    "tittyfuck - pov": "Titfuck", "big tits worship": "Titfuck",
    "tit play": "Titfuck", "tits play": "Titfuck", "boob play": "Titfuck",
    "titty sucking": "Sucking Tits", "tits sucking": "Sucking Tits",
    "nipple sucking": "Sucking Tits", "nipple play": "Sucking Tits",
    "anal": "Anal", "anal play": "Anal", "anal fingering": "Anal Fingering",
    "anal toys": "Anal Toys", "bikini lingerie": "Bikini/Lingerie", "anal attempt": "Anal", "insertion": "Anal",
    "pussy insertion": "Anal", "vaginal penetration": "Vaginal Sex",
    "vaginal fucking": "Vaginal Sex", "ass penetration": "Anal", "sex": "Sex",
    "hardcore": "Sex", "hard fuck": "Sex", "pounded": "Sex", "pounding": "Sex",
    "on knee": "Sex", "side fuck": "Side Fuck", "side sex": "Side Fuck",
    "ebony side sex": "Side Fuck", "fuck n lick": "Fuck N Lick",
    "cumshot": "Cumshot", "cum shot": "Cumshot", "cumshots": "Cumshot",
    "ejaculation": "Cumshot", "cum": "Cumshot",
    "facial": "Facial", "facials": "Facial", "facial - pov": "Facial",
    "facial - multiple": "Facial", "open mouth facial": "Facial",
    "cum on face": "Facial",
    "cum in mouth": "Cum In Mouth", "oral creampie": "Cum In Mouth",
    "swallowing": "Swallowing", "swallow": "Swallowing", "cum swap": "Cum Swap",
    "cum swapping": "Cum Swap",
    "creampie": "Creampie", "cream pie": "Creampie", "anal creampie": "Creampie",
    "vaginal creampie": "Creampie", "pussy creampie": "Creampie",
    "drooling creampie": "Creampie", "creampie surprise": "Creampie",
    "double creampies": "Creampie",
    "cum on tits": "Cum On Tits", "cum on ass": "Cum On Ass",
    "cum on body": "Cum On Body", "cum on feet": "Cum On Feet",
    "cum on pussy": "Cum On Pussy",
    "69": "69", "69 doggystyle": "69",
    "spoon": "Spooning", "spooning": "Spooning",
    "piledriver": "Piledriver", "pile driver": "Piledriver", "pile drive": "Piledriver",
    "pile driving": "Piledriver",
    "squirting": "Squirting", "squirt": "Squirting", "squirting orgasm": "Squirting",
    "double penetration": "Double Penetration",
    "double vaginal penetration": "Double Penetration",
    "prone bone": "Prone Bone", "standing": "Standing",
    "stand and carry": "Stand And Carry", "riding": "Riding",
    "spit roast": "Spit Roast", "fisting": "Fisting", "gape": "Gaping",
    "gaping": "Gaping", "bent over": "Bent Over", "spreading legs": "Spreading Legs",
    "spread eagle": "Spreading Legs", "squat": "Squatting", "cowboy": "Cowgirl", "synbian": "Sybian",
    "pussy licking": "Pussy Eating", "pussy eating": "Pussy Eating",
    "eating pussy": "Pussy Eating", "cunnilingus": "Pussy Eating",
    "sideview pussy eating": "Pussy Eating", "pov pussy eating": "Pussy Eating",
    "close up lick": "Pussy Eating", "mouth on pussy": "Pussy Eating",
    "ass licking": "Ass Licking", "asslicking": "Ass Licking", "ass worship": "Ass Licking",
    "rimming": "Rimming", "rimjob": "Rimming",
    "ball licking": "Ball Sucking", "ball sucking": "Ball Sucking",
    "ball suck": "Ball Sucking", "anal ball suck": "Ball Sucking",
    "ass to mouth": "Ass To Mouth",
    "fingering": "Fingering", "pussy fingering": "Fingering",
    "ass fingering": "Fingering", "pussy rubbing": "Fingering",
    "cock rubbing pussy": "Fingering", "masturbation": "Masturbation",
    "masturbating": "Masturbation", "female-masturbation": "Masturbation",
    "male-masturbation": "Masturbation", "playing with herself": "Masturbation",
    "playing with self": "Masturbation", "playing with herself ": "Masturbation",
    "playing with each other": "Mutual Masturbation",
    "young teen masturbating": "Masturbation",
    "kissing": "Kissing", "pov kissing": "Kissing", "lesbian kissing": "Kissing",
    "spanking": "Spanking", "choking": "Choking", "gagging": "Gagging",
    "face sitting": "Face Sitting", "facesitting": "Face Sitting",
    "face riding": "Face Sitting", "orgasm": "Orgasm", "female orgasm": "Orgasm",
    "girl orgasm": "Orgasm", "intense orgasm": "Orgasm", "her orgasm": "Orgasm",
    "undressing": "Undressing", "getting dressed": "Undressing",
    "taking off shoes": "Undressing", "taking off panties": "Undressing",
    "taking panties down": "Undressing", "blake removes panties": "Undressing",
    "blake take off bra": "Undressing", "scarlett removes panties": "Undressing",
    "scarlett take off bra": "Undressing",
    "teasing": "Teasing", "tease": "Teasing",
    "twerking": "Twerking", "amazing twerk": "Twerking",
    "dancing": "Dancing", "slow dance": "Dancing", "strip": "Striptease",
    "striptease": "Striptease", "posing": "Posing", "posing ": "Posing",
    "walk away": "Walk Away", "walk out": "Walk Away", "walking": "Walking",
    "show tits": "Showing Tits", "showing tits": "Showing Tits",
    "show ass": "Showing Ass", "showing ass": "Showing Ass", "ass shot": "Showing Ass",
    "showing panties": "Showing Panties", "panty shot": "Showing Panties",
    "showing pussy": "Showing Pussy", "pussy shot": "Pussy Closeup",
    "pussy closeup": "Pussy Closeup", "pussy close up": "Pussy Closeup",
    "pussy view": "Pussy Closeup", "pussy very closeup": "Pussy Closeup",
    "close up": "Close Up", "closeup": "Close Up",
    "oil": "Oil", "oiled": "Oil", "oiled up": "Oil", "wet": "Wet",
    "massage": "Massage", "massaging breasts": "Massage",
    "caress": "Caress", "fondling": "Fondling", "grinding": "Grinding",
    "dildo": "Dildo", "toys": "Toys", "sex toys": "Toys", "magic wand": "Toys",
    "vibrating": "Toys", "butt plug": "Toys", "sybian": "Sybian",
    "strapon": "Strap-On", "strap-on": "Strap-On", "scissoring": "Scissoring",
    "scissors": "Scissoring", "lesbian": "Lesbian", "daisy chain": "Daisy Chain",
    "orgy": "Orgy", "one-on-one": "Sex", "blindfold": "Blindfold",
    "bondage": "Bondage", "femdom": "Femdom", "whip": "Whip", "kinky": "Kinky",
    "fetish": "Fetish", "dirty talk": "Dirty Talk", "spitting": "Spitting",
    "pissing": "Pissing", "aftercare": "Aftercare", "ahegao": "Ahegao",
    "daddy": "Daddy", "interview": "Interview", "outdoors": "Outdoors",
    "indoors": "Indoors", "shower": "Shower", "pool": "Pool", "bedroom": "Bedroom",
    "office": "Office", "against wall": "Against Wall", "white wall": "White Wall",
    "white couch": "White Couch", "on couch": "On Couch", "from chapter": "From Chapter",
    "chapter": "From Chapter", "pov": "POV", "slow mo": "Slow Mo",
    "split screen": "Split Screen", "uniform": "Uniform", "nude shots": "Nude Shots",
    "public flashing": "Public Flashing", "squeezing tits": "Squeezing Tits",
    "ass shaking": "Ass Shaking", "shaking ass": "Ass Shaking",
    "bouncing tits": "Bouncing Tits", "bouncing boobs": "Bouncing Tits",
    "bouncing breasts": "Bouncing Tits", "spreading ass": "Spreading Ass",
    "ass grabbing": "Ass Grabbing", "grabbing ass": "Ass Grabbing",
    "toe sucking": "Toe Sucking", "feet": "Feet", "feet licking": "Feet",
    "amazon": "Amazon", "amazon position": "Amazon", "bridge": "Bridge",
    "arch": "Arch", "wide open": "Wide Open", "underneath": "Underneath",
    "updog": "Updog", "flexible": "Flexible", "nastiest thing": "Nastiest Thing",
    "rough sex": "Sex", "close up-sybian": "Sybian", "butter churner": "Butter Churner",
    "reverse hanging garden": "Reverse Hanging Garden", "insertion ": "Anal",
    "squat.fuck": "Squatting", "dance.on.dick": "Dancing",
    "fucking.after.creampie": "Creampie", "walk away ": "Walk Away",
    "blowjob - pov ": "Blowjob", "breast play": "Titfuck", "breast shot": "Titfuck",
    "butts": "Butts", "cum on person": "Cum On Body", "spreading": "Spreading Legs",
    "showing": "Showing Tits", "seashell": "Seashell", "runway walk": "Runway Walk",
    "open mouth": "Facial", "anal winking": "Anal", "closeup ": "Close Up",
}

# names that are junk but mean nothing to fold into: reported, never touched
JUNK = re.compile(r"^(chapter|marker)\s*\d+$", re.I)

EXCEPTIONS = {
    "pov": "POV", "bg": "BG", "gg": "GG", "69": "69", "bdsm": "BDSM",
    "bbc": "BBC", "vr": "VR", "ai": "AI", "pov kissing": "POV Kissing",
}
STOP = {"a", "an", "the", "of", "on", "in", "to", "and", "for", "with", "at", "from", "up"}


def strip_noise(name):
    text = name.strip()
    text = re.sub(r"^\[[^\]]*\]\s*", "", text)          # [TsTrade] scrape prefixes
    text = re.sub(r"^[\W_]+", "", text)                 # stray emoji/punctuation
    text = re.sub(r"^0+(?=[A-Za-z])", "", text)          # "0Doggystyle" scrape prefix
    text = re.sub(r"^act:\s*", "", text, flags=re.I)    # "Act: Cowgirl"
    text = re.sub(r"_[Aa][Ii]$", "", text)              # ..._AI suffixes
    text = re.sub(r"\(\s*pov\s*\)$", "", text, flags=re.I)
    text = re.sub(r"\s*\([^)]*\)\s*$", "", text)      # "(Clearly Visible)" qualifiers
    text = re.sub(r"\s*[-\u2013]\s*pov$", "", text, flags=re.I)
    text = re.sub(r"^pov\s+", "", text, flags=re.I)
    text = re.sub(r"\s+pov$", "", text, flags=re.I)
    text = text.replace("_", " ").replace(".", " ")
    text = re.sub(r"\s+", " ", text)
    return text.strip(" -:,")


ORDINALS = {"2nd": "Second", "3rd": "Third", "4th": "Fourth", "5th": "Fifth"}


def title_case(text):
    words = []
    for at, word in enumerate(text.split(" ")):
        low = word.lower()
        if low in ORDINALS:
            words.append(ORDINALS[low])
        elif low in EXCEPTIONS:
            words.append(EXCEPTIONS[low])
        elif at > 0 and low in STOP:
            words.append(low)
        elif "'" in low:
            words.append("-".join(part[:1].upper() + part[1:] for part in low.split("-")))
        elif "/" in low:
            words.append("/".join(part[:1].upper() + part[1:] for part in low.split("/")))
        else:
            words.append("-".join(part[:1].upper() + part[1:] for part in low.split("-")))
    return " ".join(words)


def strip_owner(text):
    """"Scarlett doggy", "Blake missionary": a performer's name glued to an act.

    Only strip the first word when what is left is an act we already know, so a
    name that merely starts with a person stays untouched."""
    parts = text.split(" ")
    if len(parts) < 2:
        return text
    # "2nd cumshot", "3rd anal": a number is part of the name, never a name
    if parts[0][:1].isdigit() or parts[0].lower() in ORDINALS or parts[0].lower() in (
        "first", "second", "third", "fourth", "last", "another",
    ):
        return text
    rest = " ".join(parts[1:]).lower().strip(" '")
    if rest in CANON or rest.replace("'s", "") in CANON:
        return " ".join(parts[1:])
    return text


def canonical(raw):
    """Returns (new_name, reason). new_name None means leave it alone."""
    text = strip_noise(raw)
    if not text:
        return None, "untitled"
    if JUNK.match(text):
        # "Marker 7", "Chapter 12": generated names with nothing in them. Fold
        # to untitled so the name list stays clean; the markers themselves stay.
        return "", "junk"
    low = text.lower()
    if low not in CANON:
        trimmed = strip_owner(text)
        if trimmed != text and trimmed.lower() in CANON:
            return CANON[trimmed.lower()], "alias"
    if low in CANON:
        return CANON[low], "alias"
    guess = title_case(text)
    if guess.lower() in CANON:
        return CANON[guess.lower()], "alias"
    return guess, "tidy"


def gql(query, variables, port):
    key = None
    for line in open("/root/.stash/config.yml"):
        if line.startswith("api_key:"):
            key = line.split(":", 1)[1].strip()
    body = json.dumps({"query": query, "variables": variables}).encode()
    req = urllib.request.Request(
        "http://127.0.0.1:%d/graphql" % port, data=body,
        headers={"Content-Type": "application/json", "ApiKey": key})
    return json.load(urllib.request.urlopen(req, timeout=600))


def main():
    args = sys.argv[1:]
    port = int(args[args.index("--port") + 1]) if "--port" in args else 9997
    apply = "--apply" in args
    fill = "--fill-untitled" in args
    data = gql(
        "query { findSceneMarkers(filter: { per_page: -1 }) "
        "{ scene_markers { id title primary_tag { name } } } }", {}, port)
    markers = data["data"]["findSceneMarkers"]["scene_markers"]

    changes, kept = [], 0
    report = {}
    for marker in markers:
        if fill and not (marker["title"] or "").strip():
            # an untitled marker still knows what it is: its primary tag
            tag = (marker.get("primary_tag") or {}).get("name") or ""
            new, _ = canonical(tag)
            if new and new.strip():
                changes.append((marker["id"], "", new))
            continue
        new, reason = canonical(marker["title"] or "")
        if new is None or new == (marker["title"] or "").strip():
            kept += 1
            continue
        changes.append((marker["id"], marker["title"], new))
        report.setdefault(reason, []).append((marker["title"], new))

    print("markers: %d   rewritten: %d   untouched: %d" % (len(markers), len(changes), kept))
    from collections import Counter
    final = Counter()
    mapping = Counter()
    for _, old, new in changes:
        mapping[(old, new)] += 1
        final[new] += 1
    for (old, new), n in mapping.most_common(60):
        print("  %4d  %-38s -> %s" % (n, old, new))
    final_all = Counter()
    for marker in markers:
        new, _ = canonical(marker["title"] or "")
        final_all[new if new is not None else (marker["title"] or "").strip()] += 1
    print("\ndistinct names after: %d" % len(final_all))
    for name, n in final_all.most_common(80):
        print("  %5d  %s" % (n, name))

    if apply:
        done = 0
        for marker_id, _, new in changes:
            gql("mutation($id: ID!, $t: String!) { sceneMarkerUpdate(input: { id: $id, title: $t }) { id } }",
                {"id": marker_id, "t": new}, port)
            done += 1
            if done % 200 == 0:
                print("  ... %d" % done)
        print("applied %d renames" % done)


if __name__ == "__main__":
    main()
