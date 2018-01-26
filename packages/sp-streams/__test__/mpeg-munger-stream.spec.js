import fs from "fs";
import path from "path";
import crypto from "crypto";

import munger from "../src/mpeg-munger-stream.js";

const hashFile = function(filename) {
  const data = fs.readFileSync(filename);
  return crypto
    .createHmac("sha256", "")
    .update(data)
    .digest("hex");
};

const testForFile = function(fileDetails) {
  const testFile = path.resolve(__dirname, fileDetails.name);
  const testFileOut = path.resolve(__dirname, fileDetails.name + ".out");
  describe(fileDetails.name, function() {
    let readStream;
    let writeStream;

    beforeEach(function() {
      readStream = fs.createReadStream(testFile);
      writeStream = fs.createWriteStream(testFileOut);
    });

    afterEach(function() {
      if (fs.existsSync(testFileOut)) {
        fs.unlinkSync(testFileOut);
      }
    });

    it("should keep streams intact if given no operation", function(done) {
      const mStream = munger();
      readStream.pipe(mStream);
      mStream.pipe(writeStream);
      writeStream.on("finish", function() {
        const inStats = fs.statSync(testFile);
        const outStats = fs.statSync(testFileOut);
        expect(inStats.size).toEqual(outStats.size);
        expect(hashFile(testFile)).toEqual(hashFile(testFileOut));
        done();
      });
    });

    // Gonna do as much monkeypatching for testing as I can, so that every single line of code in
    // the live-video code path is as lean as possible.
    it("should get an accurate packet count", function(done) {
      let packets = 0;
      let headers = 0;
      const mStream = munger();
      const origRewrite = mStream._rewrite;
      const origRewriteHeader = mStream._rewriteHeader;
      mStream._rewrite = function(...args) {
        packets += 1;
        return origRewrite.call(mStream, ...args);
      };
      mStream._rewriteHeader = function(...args) {
        headers += 1;
        return origRewriteHeader.call(mStream, ...args);
      };
      readStream.pipe(mStream);
      mStream.pipe(writeStream);
      writeStream.on("finish", function() {
        expect(packets).toEqual(fileDetails.packets);
        expect(headers).toEqual(fileDetails.headers);
        done();
      });
    });

    it("should handle packets less than and equal to 188 bytes in size", function(done) {
      const mStream = munger();
      readStream.on("data", function(chunk) {
        let startIdx = 0;
        let increment = 0;
        while (startIdx < chunk.length) {
          let endIdx = startIdx + increment;
          if (endIdx > chunk.length) {
            endIdx = chunk.length;
          }
          increment = (increment + 1) % 200;
          mStream.write(chunk.slice(startIdx, endIdx));
          startIdx = endIdx;
        }
      });
      readStream.on("end", function() {
        mStream.end();
      });
      mStream.pipe(writeStream);
      writeStream.on("finish", function() {
        const inStats = fs.statSync(testFile);
        const outStats = fs.statSync(testFileOut);
        expect(inStats.size).toEqual(outStats.size);
        expect(hashFile(testFile)).toEqual(hashFile(testFileOut));
        done();
      });
    });

    // Manually checked from the file
    // First: PTS: 132030, DTS: 126000
    // Last: PTS: 5529060, DTS: 5523030
    // Taking advantage of the fact that PTS is always parsed before DTS here.
    it("should correctly parse PTS and DTS", function(done) {
      let firstPTS = null;
      let firstDTS = null;
      let lastPTS = null;
      let lastDTS = null;
      const mStream = munger();
      mStream.transformPTS = function(pts) {
        if (firstPTS === null) {
          firstPTS = pts;
        }
        lastPTS = pts;
        return pts;
      };
      mStream.transformDTS = function(dts) {
        if (firstDTS === null) {
          firstDTS = dts;
        }
        lastDTS = dts;
        return dts;
      };
      readStream.pipe(mStream);
      mStream.pipe(writeStream);
      writeStream.on("finish", function() {
        expect(firstPTS).toEqual(fileDetails.firstPTS);
        expect(firstDTS).toEqual(fileDetails.firstDTS);
        expect(lastPTS).toEqual(fileDetails.lastPTS);
        expect(lastDTS).toEqual(fileDetails.lastDTS);
        done();
      });
    });

    it("should correctly offset PTS and DTS", function(done) {
      let firstPTS = null;
      let firstDTS = null;
      let lastPTS = null;
      let lastDTS = null;

      const mWriteStream = munger();
      // Never actually do this, lol
      mWriteStream.transformPTS = function(pts) {
        pts += 1000;
        if (firstPTS === null) {
          firstPTS = pts;
        }
        lastPTS = pts;
        return pts;
      };
      mWriteStream.transformDTS = function(dts) {
        dts -= 1000;
        if (firstDTS === null) {
          firstDTS = dts;
        }
        lastDTS = dts;
        return dts;
      };

      const mReadStream = munger();
      readStream.pipe(mWriteStream);
      mWriteStream.pipe(mReadStream);
      mReadStream.pipe(writeStream);
      writeStream.on("finish", function() {
        const expectedFirstDTS = fileDetails.firstDTS
          ? fileDetails.firstDTS - 1000
          : null;
        const expectedLastDTS = fileDetails.lastDTS
          ? fileDetails.lastDTS - 1000
          : null;
        expect(firstPTS).toEqual(fileDetails.firstPTS + 1000);
        expect(firstDTS).toEqual(expectedFirstDTS);
        expect(lastPTS).toEqual(fileDetails.lastPTS + 1000);
        expect(lastDTS).toEqual(expectedLastDTS);
        done();
      });
    });
  });
};

testForFile({
  name: "testvid.ts",
  packets: 2872,
  headers: 1800,
  firstPTS: 132030,
  lastPTS: 5529060,
  firstDTS: 126000,
  lastDTS: 5523030
});

testForFile({
  name: "elis-face.ts",
  packets: 29900,
  headers: 1206,
  firstPTS: 128090,
  lastPTS: 2826017,
  firstDTS: null,
  lastDTS: null
});
