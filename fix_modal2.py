#!/usr/bin/env python3
# Simple transformation: wrap project modal in header/body/footer and add section headers

with open('src/App.tsx', 'r') as f:
    content = f.read()

# 1. Wrap the title in modal-header
old1 = '''            <h2>{editingProject ? 'Edit Project' : 'New Project'}</h2>
            
            <div className="form-group">
              <label>Project Name</label>'''

new1 = '''            <div className="modal-header">
              <h2>{editingProject ? 'Edit Project' : 'New Project'}</h2>
            </div>
            
            <div className="modal-body">
              <div className="form-section">
                <div className="form-section-title">Basic Info</div>
                
                <div className="form-group">
                  <label>Project Name</label>'''

content = content.replace(old1, new1)

# 2. After Business Line closing </div>, add section header for Design Artifacts
old2 = '''                </label>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label>Design Deck Name</label>'''

new2 = '''                </label>
                ))}
              </div>
              </div>
              </div>

              <div className="form-section">
                <div className="form-section-title">Design Artifacts</div>

            <div className="form-group">
              <label>Design Deck Name</label>'''

content = content.replace(old2, new2)

# 3. After Figma Link, add section header for Custom Links  
old3 = '''              />
            </div>

            <div className="form-group">
              <label>Custom Links (max 3)</label>'''

new3 = '''              />
            </div>
              </div>

              <div className="form-section">
                <div className="form-section-title">Custom Links</div>

            <div className="form-group">
              <label>Custom Links (max 3)</label>'''

content = content.replace(old3, new3)

# 4. After Custom Links, add section header for Status
old4 = '''                </button>
              )}
            </div>

            <div className="form-group">
              <label>Status</label>'''

new4 = '''                </button>
              )}
            </div>
              </div>

              <div className="form-section">
                <div className="form-section-title">Status & Schedule</div>

            <div className="form-group">
              <label>Status</label>'''

content = content.replace(old4, new4)

# 5. After timeline, add section header for Team
old5 = '''              />
            </div>

            <div className="form-group">
              <label>Designers</label>'''

new5 = '''              />
            </div>
              </div>

              <div className="form-section">
                <div className="form-section-title">Team</div>

            <div className="form-group">
              <label>Designers</label>'''

content = content.replace(old5, new5)

# 6. Close the modal-body and add modal-footer
old6 = '''                </label>
                ))}
              </div>
            </div>

            <div className="modal-actions">'''

new6 = '''                </label>
                ))}
              </div>
              </div>
            </div>

            <div className="modal-footer">'''

content = content.replace(old6, new6)

# 7. Update modal-actions to modal-footer in buttons
old7 = '''            <div className="modal-footer">
              <button className="secondary-btn" onClick={() => setShowProjectModal(false)}>Cancel</button>
              <button className="primary-btn" onClick={handleSaveProject}>
                {editingProject ? 'Save Changes' : 'Add Project'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showTimelineModal && ('''

new7 = '''            <div className="modal-footer">
              <button className="secondary-btn" onClick={() => setShowProjectModal(false)}>Cancel</button>
              <button className="primary-btn" onClick={handleSaveProject}>
                {editingProject ? 'Save Changes' : 'Add Project'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showTimelineModal && ('''

content = content.replace(old7, new7)

with open('src/App.tsx', 'w') as f:
    f.write(content)

print("Done!")
