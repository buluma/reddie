const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

// The destination is replaced only after a complete write. A failed write
// leaves the last readable configuration intact.
function writeJsonAtomic(destination, value) {
  const temporary = path.join(path.dirname(destination), `.${path.basename(destination)}.${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, destination);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

module.exports = { writeJsonAtomic };
