#!/usr/bin/env python3
import re

# Read the file
with open('src/App.tsx', 'r') as f:
    content = f.read()

# Find the project modal section and replace it
old_start = '''      {showProjectModal && (
        <div className="modal-overlay" onClick={() => setShowProjectModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>{editingProject ? 'Edit Project' : 'New Project'}</h2>
            
            <div className="form-group">
              <label>Project Name</label>'''

new_start = '''      {showProjectModal && (
        <div className="modal-overlay" onClick={() => setShowProjectModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingProject ? 'Edit Project' : 'New Project'}</h2>
            </div>
            
            <div className="modal-body">
              {/* Basic Info */}
              <div className="form-section">
                <div className="form-section-title">Basic Info</div>
                
                <div className="form-group">
                  <label>Project Name</label>'''

content = content.replace(old_start, new_start)

# Replace the closing section
old_end = '''            <div className="modal-actions">
              <button className="secondary-btn" onClick={() => setShowProjectModal(false)}>Cancel</button>
              <button className="primary-btn" onClick={handleSaveProject}>
                {editingProject ? 'Save Changes' : 'Add Project'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showTimelineModal && ('''

new_end = '''            </div>

            <div className="modal-footer">
              <button className="secondary-btn" onClick={() => setShowProjectModal(false)}>Cancel</button>
              <button className="primary-btn" onClick={handleSaveProject}>
                {editingProject ? 'Save Changes' : 'Add Project'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showTimelineModal && ('''

content = content.replace(old_end, new_end)

# Add form sections after Business Line (end of Basic Info section)
old_business_line_end = '''                  </label>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label>Design Deck Name</label>'''

new_business_line_end = '''                  </label>
                ))}
              </div>
                </div>
              </div>

              {/* Design Artifacts */}
              <div className="form-section">
                <div className="form-section-title">Design Artifacts</div>

            <div className="form-group">
              <label>Design Deck Name</label>'''

content = content.replace(old_business_line_end, new_business_line_end)

# Add form section closing after Figma Link, before Custom Links
old_figma_end = '''              />
            </div>

            <div className="form-group">
              <label>Custom Links (max 3)</label>'''

new_figma_end = '''              />
            </div>
              </div>

              {/* Custom Links */}
              <div className="form-section">
                <div className="form-section-title">Custom Links</div>

            <div className="form-group">
              <label>Custom Links (max 3)</label>'''

content = content.replace(old_figma_end, new_figma_end)

# Add form section closing after Custom Links, before Status
old_custom_links_end = '''                </button>
              )}
            </div>

            <div className="form-group">
              <label>Status</label>'''

new_custom_links_end = '''                </button>
              )}
            </div>
              </div>

              {/* Status & Schedule */}
              <div className="form-section">
                <div className="form-section-title">Status & Schedule</div>

            <div className="form-group">
              <label>Status</label>'''

content = content.replace(old_custom_links_end, new_custom_links_end)

# Add form section closing after timeline/date, before Designers
old_timeline_end = '''              />
            </div>

            <div className="form-group">
              <label>Designers</label>'''

new_timeline_end = '''              />
            </div>
              </div>

              {/* Team */}
              <div className="form-section">
                <div className="form-section-title">Team</div>

            <div className="form-group">
              <label>Designers</label>'''

content = content.replace(old_timeline_end, new_timeline_end)

# Add form section closing after Designers
old_designers_end = '''                </label>
                ))}
              </div>
            </div>

            <div className="modal-footer">'''

new_designers_end = '''                </label>
                ))}
              </div>
            </div>
              </div>

            <div className="modal-footer">'''

content = content.replace(old_designers_end, new_designers_end)

# Write the file
with open('src/App.tsx', 'w') as f:
    f.write(content)

print("Done!")
