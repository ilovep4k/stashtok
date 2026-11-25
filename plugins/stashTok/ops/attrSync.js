/* StashTok TagSync — the server-side half of bulk tagging.
 *
 * Runs INSIDE the Stash process as a plugin task, so the work survives the
 * browser being closed, and Stash's own job queue gives it progress and a Stop.
 *
 * Cost model that shapes this file: a bulk update costs ~650 ms PER ROW, and
 * tags ride along free. So a scene missing three tags is written ONCE with all
 * three, never three times. The caller sends per-tag id lists; this groups rows
 * by their exact tag set, so the number of writes is the number of distinct
 * (row -> tagset) pairs rather than the number of tags.
 *
 * Input (args_map — every value arrives as a string):
 *   mode        "add" | "remove"                          (default add)
 *   performerId optional; on add the performer carries the tags too
 *   entries     JSON [{ tagId, name, scenes: [ids], images: [ids] }]
 *               The caller computes these — it already holds the library state —
 *               which is also what makes undo exact: replay the same payload
 *               with mode "remove".
 *   chunk       rows per mutation (default 100)
 */
(function () {
  /* goja exposes the Go struct without json tags, so fields arrive capitalised */
  var args = (input && (input.Args || input.args)) || {};

  function out(text) {
    var s = String(text);
    return { output: s, Output: s };
  }

  function fail(message) {
    var s = String(message);
    return { error: s, Error: s };
  }

  function gqlData(query, variables) {
    var res = gql.Do(query, variables || {});
    if (res && res.errors && res.errors.length) {
      throw new Error(res.errors[0].message || "graphql error");
    }
    return (res && res.data) || res || {};
  }

  function parseJson(raw, fallback) {
    if (!raw) return fallback;
    if (Object.prototype.toString.call(raw) === "[object Array]") return raw;
    try {
      var parsed = JSON.parse(String(raw));
      return parsed == null ? fallback : parsed;
    } catch (e) {
      return fallback;
    }
  }

  function strings(list) {
    var acc = [];
    if (!list) return acc;
    for (var i = 0; i < list.length; i += 1) {
      var v = String(list[i]).trim();
      if (v) acc.push(v);
    }
    return acc;
  }

  /* rows grouped by the exact set of tags they need, so every row is written
     once no matter how many tags it carries */
  function groupByTagSet(entries, key) {
    var byRow = {};
    var order = [];
    for (var e = 0; e < entries.length; e += 1) {
      var tagId = String(entries[e].tagId);
      var ids = strings(entries[e][key]);
      for (var i = 0; i < ids.length; i += 1) {
        var row = ids[i];
        if (!byRow[row]) {
          byRow[row] = [];
          order.push(row);
        }
        if (byRow[row].indexOf(tagId) < 0) byRow[row].push(tagId);
      }
    }
    var groups = {};
    var grouped = [];
    for (var r = 0; r < order.length; r += 1) {
      var row2 = order[r];
      var sig = byRow[row2].slice().sort().join(",");
      if (!groups[sig]) {
        groups[sig] = { tagIds: byRow[row2].slice().sort(), ids: [] };
        grouped.push(groups[sig]);
      }
      groups[sig].ids.push(row2);
    }
    return grouped;
  }

  function writeRows(kind, ids, tagIds, mode) {
    var verb = mode === "remove" ? "REMOVE" : "ADD";
    var query =
      kind === "images"
        ? 'mutation($ids: [ID!]!, $tags: [ID!]!) { bulkImageUpdate(input: { ids: $ids, tag_ids: { ids: $tags, mode: ' + verb + ' } }) { id } }'
        : 'mutation($ids: [ID!]!, $tags: [ID!]!) { bulkSceneUpdate(input: { ids: $ids, tag_ids: { ids: $tags, mode: ' + verb + ' } }) { id } }';
    return gqlData(query, { ids: ids, tags: tagIds });
  }

  function main() {
    var mode = String(args.mode || "add").toLowerCase() === "remove" ? "remove" : "add";
    var chunk = Math.max(1, Math.min(200, Number(args.chunk) || 100));
    var performerId = args.performerId ? String(args.performerId) : "";
    var entries = parseJson(args.entries, []);
    if (!entries || !entries.length) return fail("entries is required (per-tag id lists)");

    var sceneGroups = groupByTagSet(entries, "scenes");
    var imageGroups = groupByTagSet(entries, "images");
    var sceneRows = 0;
    var imageRows = 0;
    for (var g = 0; g < sceneGroups.length; g += 1) sceneRows += sceneGroups[g].ids.length;
    for (var h = 0; h < imageGroups.length; h += 1) imageRows += imageGroups[h].ids.length;
    var totalRows = sceneRows + imageRows;

    log.Info("StashTok: " + mode + " " + entries.length + " tag(s) over " + sceneRows +
      " scenes and " + imageRows + " images (~" + Math.round(totalRows * 0.65) + "s)");

    if (!totalRows && !performerId) return out("StashTok: nothing to do");

    /* the performer carries the attribute too: that is the point of the sync,
       and undo has to take it back off her as well */
    if (performerId) {
      var performerTags = [];
      for (var p = 0; p < entries.length; p += 1) {
        var tid = String(entries[p].tagId);
        if (performerTags.indexOf(tid) < 0) performerTags.push(tid);
      }
      if (performerTags.length) {
        gqlData(
          'mutation($id: ID!, $tags: [ID!]!, $mode: BulkUpdateIdMode!) {' +
            ' bulkPerformerUpdate(input: { ids: [$id], tag_ids: { ids: $tags, mode: $mode } }) { id } }',
          { id: performerId, tags: performerTags, mode: mode === "remove" ? "REMOVE" : "ADD" }
        );
      }
    }

    var done = 0;
    if (!totalRows) { log.Progress(1); return out("StashTok: performer tags updated, no rows to write"); }

    for (var s = 0; s < sceneGroups.length; s += 1) {
      var sg = sceneGroups[s];
      for (var sc = 0; sc < sg.ids.length; sc += chunk) {
        writeRows("scenes", sg.ids.slice(sc, sc + chunk), sg.tagIds, mode);
        done += Math.min(chunk, sg.ids.length - sc);
        log.Progress(Math.min(0.99, done / totalRows));
      }
    }

    for (var im = 0; im < imageGroups.length; im += 1) {
      var ig = imageGroups[im];
      for (var ic = 0; ic < ig.ids.length; ic += chunk) {
        writeRows("images", ig.ids.slice(ic, ic + chunk), ig.tagIds, mode);
        done += Math.min(chunk, ig.ids.length - ic);
        log.Progress(Math.min(0.99, done / totalRows));
      }
    }

    log.Progress(1);
    return out("StashTok: " + mode + " complete — " + sceneRows + " scenes, " + imageRows +
      " images in " + (sceneGroups.length + imageGroups.length) + " write groups");
  }

  return main();
})();
