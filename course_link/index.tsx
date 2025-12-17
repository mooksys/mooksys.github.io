import { useState } from 'react';
import { Link, Copy, Check, Download } from 'lucide-react';

export default function CourseLinkGenerator() {
  const [baseAddress, setBaseAddress] = useState('http://mp4.itgo.co.kr/mp4/');
  const [code, setCode] = useState('');
  const [lectureCount, setLectureCount] = useState('');
  const [generatedLinks, setGeneratedLinks] = useState([]);
  const [copiedIndex, setCopiedIndex] = useState(null);

  const generateLinks = () => {
    if (code && lectureCount) {
      const count = parseInt(lectureCount);
      const links = [];
      for (let i = 1; i <= count; i++) {
        const paddedNum = i.toString().padStart(2, '0');
        links.push({
          lecNum: i,
          url: `${baseAddress}${code}/${paddedNum}.mp4`
        });
      }
      setGeneratedLinks(links);
      setCopiedIndex(null);
    }
  };

  const copyToClipboard = (text, index) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const copyAllLinks = () => {
    const allLinks = generatedLinks.map(link => link.url).join('\n');
    navigator.clipboard.writeText(allLinks);
    setCopiedIndex('all');
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const resetForm = () => {
    setCode('');
    setLectureCount('');
    setGeneratedLinks([]);
    setCopiedIndex(null);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
          {/* Header */}
          <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-6">
            <div className="flex items-center gap-3">
              <div className="bg-white/20 p-3 rounded-lg">
                <Link className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white">과목 링크 생성기</h1>
                <p className="text-blue-100 text-sm">강좌 정보를 입력하여 링크를 자동 생성하세요</p>
              </div>
            </div>
          </div>

          {/* Input Form */}
          <div className="p-6 bg-gray-50 border-b border-gray-200">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Base Address
                </label>
                <input
                  type="text"
                  value={baseAddress}
                  onChange={(e) => setBaseAddress(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Code
                </label>
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="N100123"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  강좌수
                </label>
                <input
                  type="number"
                  value={lectureCount}
                  onChange={(e) => setLectureCount(e.target.value)}
                  placeholder="13"
                  min="1"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div className="flex items-end gap-2">
                <button
                  onClick={generateLinks}
                  className="flex-1 bg-blue-600 text-white py-2 px-4 rounded-lg font-medium hover:bg-blue-700 transition-colors"
                >
                  생성
                </button>
                <button
                  onClick={resetForm}
                  className="px-4 py-2 border border-gray-300 rounded-lg font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  초기화
                </button>
              </div>
            </div>
          </div>

          {/* Results Table */}
          {generatedLinks.length > 0 && (
            <div className="p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-semibold text-gray-800">
                  생성된 링크 ({generatedLinks.length}개)
                </h2>
                <button
                  onClick={copyAllLinks}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm"
                >
                  {copiedIndex === 'all' ? (
                    <>
                      <Check className="w-4 h-4" />
                      복사됨!
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4" />
                      전체 복사
                    </>
                  )}
                </button>
              </div>

              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="overflow-x-auto max-h-96 overflow-y-auto">
                  <table className="w-full">
                    <thead className="bg-gray-100 sticky top-0">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider w-24">
                          Lec_Num
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                          링크
                        </th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-700 uppercase tracking-wider w-24">
                          복사
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {generatedLinks.map((link, index) => (
                        <tr key={index} className="hover:bg-blue-50 transition-colors">
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">
                            {link.lecNum}
                          </td>
                          <td className="px-4 py-3 text-sm text-blue-600 break-all">
                            <a href={link.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                              {link.url}
                            </a>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <button
                              onClick={() => copyToClipboard(link.url, index)}
                              className="inline-flex items-center gap-1 px-3 py-1 text-xs text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 rounded transition-colors"
                            >
                              {copiedIndex === index ? (
                                <>
                                  <Check className="w-3 h-3" />
                                  복사됨
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3 h-3" />
                                  복사
                                </>
                              )}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}