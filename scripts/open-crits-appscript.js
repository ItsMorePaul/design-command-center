/**
 * W&I Open Crits — Google Apps Script (bound to the doc)
 *
 * Deploy as: Web App → Execute as Me → Anyone with link
 *
 * DCC server POSTs project data here. This script creates a new
 * dated tab and formats the content using native Google Docs elements.
 *
 * To install:
 *   1. Open the W&I Open Crit Weekly Agenda doc
 *   2. Extensions → Apps Script
 *   3. Replace Code.gs contents with this file
 *   4. Deploy → New deployment → Web app
 *      - Execute as: Me
 *      - Who has access: Anyone
 *   5. Copy the web app URL → set as DCC_OPEN_CRITS_SCRIPT_URL env var
 */

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var secret = data.secret || '';

    // Simple shared secret auth
    var props = PropertiesService.getScriptProperties();
    var expectedSecret = props.getProperty('DCC_SECRET');
    if (expectedSecret && secret !== expectedSecret) {
      return ContentService.createTextOutput(JSON.stringify({ error: 'Unauthorized' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var doc = DocumentApp.openById('1QTw96d8wjB4UyrPwb6gXYpwpnLOBBrZuo7xoB48Z08k');
    var tabTitle = data.tabTitle; // e.g. "Mar 19, 2026"
    var blGroups = data.businessLines; // { "Barron's": [{name, designers, figmaLink, deckLink, prdLink}], ... }
    var dateStr = data.dateStr; // e.g. "Mar 19, 2026"

    // Check if tab already exists
    var tabs = doc.getTabs();
    var existingTab = null;
    for (var i = 0; i < tabs.length; i++) {
      if (tabs[i].getTitle() === tabTitle) {
        existingTab = tabs[i];
        break;
      }
    }

    var tab;
    if (existingTab) {
      // Clear existing tab content
      tab = existingTab;
      var body = tab.asDocumentTab().getBody();
      body.clear();
    } else {
      // Create new tab — insert at position 1 (after "Agenda by dates")
      tab = doc.addTab(tabTitle, 1);
    }

    var body = tab.asDocumentTab().getBody();

    // === Title: "Mar 19, 2026 agenda" ===
    var title = body.appendParagraph(dateStr + ' agenda');
    title.setHeading(DocumentApp.ParagraphHeading.TITLE);

    body.appendParagraph('');

    // === "Presenting…" section ===
    var presenting = body.appendParagraph('Presenting…');
    presenting.setBold(true);

    // Placeholder bullets for presenting items
    var presItem = body.appendListItem('[Add presenting projects here]');
    presItem.setGlyphType(DocumentApp.GlyphType.BULLET);
    presItem.setNestingLevel(0);

    body.appendParagraph('');

    // === "FYI…" section ===
    var fyiHeader = body.appendParagraph('FYI…');
    fyiHeader.setBold(true);

    var fyiItem = body.appendListItem('[Add FYI items here]');
    fyiItem.setGlyphType(DocumentApp.GlyphType.BULLET);
    fyiItem.setNestingLevel(0);

    body.appendParagraph('');

    // === Horizontal rule ===
    body.appendHorizontalRule();

    body.appendParagraph('');

    // === "Full project list" heading ===
    var projectListHeader = body.appendParagraph('Full project list, updates in 2026 Design Team Weekly Highlight');
    projectListHeader.setHeading(DocumentApp.ParagraphHeading.HEADING1);

    // === Business line sections ===
    var blOrder = ["Barron's", 'MarketWatch', 'Messaging', 'Market Data', 'MarketSurge', 'IBD', 'Mansion Global', 'The Wall Street Journal', 'X-Brand'];

    // Add any extra business lines not in the standard order
    var allBls = Object.keys(blGroups);
    for (var k = 0; k < allBls.length; k++) {
      if (blOrder.indexOf(allBls[k]) === -1) {
        blOrder.push(allBls[k]);
      }
    }

    for (var b = 0; b < blOrder.length; b++) {
      var bl = blOrder[b];
      var projects = blGroups[bl];
      if (!projects || projects.length === 0) continue;

      // Business line heading
      var blHeading = body.appendParagraph(bl);
      blHeading.setHeading(DocumentApp.ParagraphHeading.HEADING2);

      // Each project as a line with inline links
      for (var p = 0; p < projects.length; p++) {
        var proj = projects[p];
        var para = body.appendParagraph('');

        // Project name — linked to deck or figma if available
        var projectLink = proj.deckLink || proj.figmaLink || '';
        if (projectLink) {
          para.appendText(proj.name).setLinkUrl(projectLink);
        } else {
          para.appendText(proj.name);
        }

        // Append links: " | Figma File | Deck | PRD"
        var links = [];
        if (proj.figmaLink) links.push({ text: 'Figma File', url: proj.figmaLink });
        if (proj.deckLink) links.push({ text: 'Deck', url: proj.deckLink });
        if (proj.prdLink) links.push({ text: 'PRD', url: proj.prdLink });

        if (links.length > 0) {
          for (var l = 0; l < links.length; l++) {
            para.appendText(' | ');
            para.appendText(links[l].text).setLinkUrl(links[l].url);
          }
        }

        // Append designers
        if (proj.designers) {
          para.appendText(' - ' + proj.designers);
        }
      }

      // Empty line after each business line section
      body.appendParagraph('');
    }

    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      tabTitle: tabTitle,
      message: 'Tab created/updated with ' + allBls.length + ' business lines'
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      error: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

// Test function — run manually in Apps Script editor
function testCreateTab() {
  var testData = {
    postData: {
      contents: JSON.stringify({
        tabTitle: 'Test Tab',
        dateStr: 'Mar 19, 2026',
        businessLines: {
          "Barron's": [
            { name: 'Test Project', designers: 'John Doe', figmaLink: 'https://figma.com/test', deckLink: '', prdLink: '' }
          ]
        }
      })
    }
  };
  var result = doPost(testData);
  Logger.log(result.getContent());
}
