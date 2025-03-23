// 在文件最开始添加背景脚本就绪标志
console.log('[Background] 背景脚本开始加载');

// 添加全局错误处理器
self.addEventListener('error', function(event) {
  // 阻止错误冒泡
  event.preventDefault();
  event.stopPropagation();
  // 仅打印到控制台
  console.error('[Background] 捕获到错误 (已阻止显示):', event.error || event.message);
  return true; // 阻止默认处理
});

// 捕获Promise未处理的rejection
self.addEventListener('unhandledrejection', function(event) {
  // 阻止错误冒泡
  event.preventDefault();
  event.stopPropagation();
  // 仅打印到控制台
  console.error('[Background] 捕获到未处理的Promise错误 (已阻止显示):', event.reason);
  return true; // 阻止默认处理
});

// 监听runtime.onInstalled事件
chrome.runtime.onInstalled.addListener(() => {
  console.log('[Background] 扩展已安装或更新');
});

// 添加一个简单的消息监听器，确保background.js能够正确响应isReady请求
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'isReady') {
    console.log('[Background] 收到就绪检查请求');
    sendResponse({ ready: true });
    return true;
  }
  // 其他消息处理继续执行
  return true;
});

// 检查API服务状态
async function checkAPIStatus(apiKey) {
  try {
    console.log('[Background] 开始检查API状态，API密钥:', apiKey.substring(0, 5) + '...');
    
    // 首先检查API密钥格式
    if (!apiKey || !apiKey.startsWith('sk-')) {
      console.error('[Background] API密钥格式无效');
      return { 
        success: false, 
        error: 'API密钥格式无效'
      };
    }
    
    // 简单返回成功，避免CORS问题
    // 实际API连接测试会在查询时进行
    return { success: true };
  } catch (error) {
    console.error('[Background] API状态检查异常:', error);
    return { 
      success: false, 
      error: error.message || 'API服务可能不可用' 
    };
  }
}

// 监听API状态检查请求
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'checkAPIStatus') {
    const { apiKey } = request;
    
    if (!apiKey) {
      sendResponse({ success: false, error: 'API密钥未设置' });
      return true;
    }
    
    (async () => {
      try {
        const result = await checkAPIStatus(apiKey);
        sendResponse(result);
      } catch (error) {
        sendResponse({ 
          success: false, 
          error: error.message || 'API服务检查失败' 
        });
      }
    })();
    
    return true; // 保持消息通道开放
  }
  return true;
});

// 处理问题文本，移除HTML标签
function cleanQuestionText(text) {
  return text.replace(/<[^>]*>/g, '').trim();
}

// 将问题分组，每组10个
function groupQuestions(questions) {
  const groups = [];
  for (let i = 0; i < questions.length; i += 10) {
    groups.push(questions.slice(i, i + 10));
  }
  return groups;
}

// 构建AI提示词
function buildPrompt(questions) {
  let prompt = '你是一个医学专家，精通中医学和西医学。接下来，我会给你问题和答案选项，你需要找到正确的答案并回答。\n\n对于单选题，请回答{答案: X}，其中X是选项字母如A、B、C、D或E。\n对于多选题，请回答{答案: X,Y,Z}，其中X,Y,Z是多个正确选项的字母，如A,B,C。\n\n';
  
  questions.forEach((q, index) => {
    const questionType = q.type === 'multiple' ? '【多选题】' : '【单选题】';
    prompt += `问题${index + 1}${questionType}：${cleanQuestionText(q.text)}\n选项：${q.options.join('、')}\n\n`;
  });
  
  return prompt;
}

// 调用AI API
async function queryAI(questions, apiKey) {
  if (!apiKey) {
    console.error('[Background] queryAI: API密钥未设置');
    throw new Error('API密钥未设置');
  }

  try {
    console.log('[Background] queryAI: 开始准备请求数据, 题目数量:', questions.length);
    const url = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation';
    
    const headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    };
    
    const prompt = buildPrompt(questions);
    console.log('[Background] queryAI: 构建的提示词:', prompt.substring(0, 100) + '...');
    
    const data = {
      'model': 'qwen-plus',
      'input': {
        'messages': [
          {
            'role': 'system',
            'content': '你是一个医学专家，精通中医学和西医学。'
          },
          {
            'role': 'user',
            'content': prompt
          }
        ]
      },
      'parameters': {
        'result_format': 'message'
      }
    };

    console.log('[Background] queryAI: 准备发送API请求');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.error('[Background] queryAI: 请求超时，中止请求');
      controller.abort();
    }, 60000); // 60秒超时

    console.log('[Background] queryAI: 开始发送请求...');
    const response = await fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(data),
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    
    console.log('[Background] queryAI: 收到API响应:', {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries())
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Background] queryAI: API错误响应:', errorText);
      throw new Error(`API调用失败: ${response.status} - ${errorText}`);
    }
    
    console.log('[Background] queryAI: 开始解析响应数据...');
    const result = await response.json();
    console.log('[Background] queryAI: 成功解析响应数据');
    
    if (!result.output || !result.output.choices || !result.output.choices[0] || !result.output.choices[0].message) {
      console.error('[Background] queryAI: API返回数据格式错误:', result);
      throw new Error('API返回数据格式错误');
    }
    
    return result.output.choices[0].message.content;
  } catch (error) {
    console.error('[Background] queryAI异常:', error);
    if (error.name === 'AbortError') {
      throw new Error('API调用超时');
    }
    throw error;
  }
}

// 解析AI回答
function parseAIResponse(response, questions) {
  console.log('[Background] parseAIResponse: 开始解析AI响应');
  console.log('[Background] parseAIResponse: 原始AI响应内容:', response);
  
  const answers = [];
  // 尝试多种格式匹配
  let patterns = [
    // 基本格式匹配
    /答案[：:]\s*([A-Z,，\s]+)/g,
    /选择\s*([A-Z,，\s]+)/g,
    /正确答案[是为：:]\s*([A-Z,，\s]+)/g,
    /答案是\s*([A-Z,，\s]+)/g,
    /选项\s*([A-Z,，\s]+)\s*是正确的/g,
    /\{答案[:：]\s*([A-Z,，\s]+)\}/g,
    /答案[:：]([A-Z,，\s]+)/g,
    /选择([A-Z,，\s]+)/g,
    /([A-Z])\s*[是为]\s*正确的/g,
    /正确选项[是为]([A-Z])/g,
    /正确答案[:：]\s*选项([A-Z])/g,
    
    // 问题编号格式
    /问题\s*\d+\s*[:：]\s*([A-Z,，]+)/g,
    /问题\s*\d+\s*答案[:：]\s*([A-Z,，]+)/g,
    /\d+\s*[\.。]\s*([A-Z,，]+)/g,
    /\d+\s*[\.。]\s*答案[:：]\s*([A-Z,，]+)/g,
    
    // 更宽松的格式
    /应该选择\s*([A-Z,，]+)/g,
    /我选择\s*([A-Z,，]+)/g,
    /我认为是\s*([A-Z,，]+)/g,
    /这道题的答案是\s*([A-Z,，]+)/g,
    /这题选\s*([A-Z,，]+)/g
  ];
  
  console.log('[Background] parseAIResponse: 尝试匹配答案模式');
  
  // 将文本分割成可能的段落，尝试逐段匹配
  const paragraphs = response.split(/[\n\r]+/);
  const questionIndices = [];
  
  // 先查找包含"问题"关键词的段落
  paragraphs.forEach((para, index) => {
    if (/问题\s*\d+/.test(para)) {
      questionIndices.push(index);
    }
  });
  
  let matched = false;
  
  // 如果找到了问题段落，尝试为每个问题段落找答案
  if (questionIndices.length > 0) {
    console.log('[Background] parseAIResponse: 检测到问题段落，尝试分段匹配');
    
    for (let i = 0; i < questionIndices.length; i++) {
      const startIdx = questionIndices[i];
      const endIdx = (i < questionIndices.length - 1) ? questionIndices[i + 1] : paragraphs.length;
      
      // 取当前问题的所有相关段落
      const relevantText = paragraphs.slice(startIdx, endIdx).join('\n');
      
      // 获取当前问题的类型（如果提供了questions参数）
      const isMultipleChoice = questions && questions[i] && questions[i].type === 'multiple';
      
      // 在相关文本中查找答案
      let foundAnswerForQuestion = false;
      for (const regex of patterns) {
        regex.lastIndex = 0; // 重置正则表达式的匹配位置
        const match = regex.exec(relevantText);
        if (match) {
          foundAnswerForQuestion = true;
          matched = true;
          console.log(`[Background] parseAIResponse: 问题${i+1}匹配到答案:`, match[1]);
          
          // 处理多选题答案，保持原始格式
          const answerText = match[1].trim();
          
          // 处理可能的逗号分隔格式
          if (answerText.includes(',') || answerText.includes('，')) {
            // 去除多余空格，但保留选项间的分隔
            const cleanedAnswer = answerText.replace(/\s*([,，])\s*/g, '$1 ').trim();
            answers.push(cleanedAnswer);
          } else {
            answers.push(answerText);
          }
          break;
        }
      }
      
      // 如果没有找到答案，尝试查找单独的字母
      if (!foundAnswerForQuestion) {
        console.log(`[Background] parseAIResponse: 问题${i+1}未找到明确答案，尝试查找单字母`);
        
        // 对于多选题，尝试找出所有可能的选项
        if (isMultipleChoice) {
          const letterMatches = relevantText.match(/\b([A-D])\b/g);
          if (letterMatches && letterMatches.length > 0) {
            // 去重，因为多选题可能会重复提到相同的字母
            const uniqueOptions = [...new Set(letterMatches)];
            if (uniqueOptions.length > 0) {
              console.log(`[Background] parseAIResponse: 问题${i+1}(多选题)找到选项:`, uniqueOptions.join(''));
              answers.push(uniqueOptions.join(''));
              foundAnswerForQuestion = true;
            }
          }
        } else {
          // 单选题处理逻辑
          // 先尝试查找{A}、[A]等格式
          let bracketMatch = /[\{\[（\(]([A-D])[\}\]）\)]/g.exec(relevantText);
          if (bracketMatch) {
            answers.push(bracketMatch[1]);
            console.log(`[Background] parseAIResponse: 问题${i+1}找到括号中的答案:`, bracketMatch[1]);
            foundAnswerForQuestion = true;
          } else {
            // 查找单独出现的字母
            const letterMatches = relevantText.match(/\b([A-D])\b/g);
            if (letterMatches && letterMatches.length > 0 && letterMatches.length <= 3) {
              answers.push(letterMatches[0]);
              console.log(`[Background] parseAIResponse: 问题${i+1}找到单字母答案:`, letterMatches[0]);
              foundAnswerForQuestion = true;
            }
          }
        }
        
        // 如果真的找不到，添加一个默认值
        if (!foundAnswerForQuestion) {
          answers.push("未知");
          console.log(`[Background] parseAIResponse: 问题${i+1}无法确定答案，使用默认值`);
        }
      }
    }
  }
  
  // 如果没有按段落匹配，尝试整体匹配
  if (!matched || answers.length === 0) {
    console.log('[Background] parseAIResponse: 分段匹配失败，尝试整体匹配');
    
    for (const regex of patterns) {
      regex.lastIndex = 0; // 重置正则表达式的匹配位置
      let match;
      while ((match = regex.exec(response)) !== null) {
        matched = true;
        console.log('[Background] parseAIResponse: 匹配到答案:', match[1]);
        
        // 处理多选题答案，保持原始格式
        const answerText = match[1].trim();
        
        // 处理可能的逗号分隔格式
        if (answerText.includes(',') || answerText.includes('，')) {
          // 去除多余空格，但保留选项间的分隔
          const cleanedAnswer = answerText.replace(/\s*([,，])\s*/g, '$1 ').trim();
          answers.push(cleanedAnswer);
        } else {
          answers.push(answerText);
        }
      }
      
      if (matched && answers.length > 0) {
        console.log('[Background] parseAIResponse: 使用模式成功匹配到答案');
        break;
      }
    }
  }
  
  // 如果仍然没有匹配到任何答案，尝试直接提取 A/B/C/D
  if (!matched || answers.length === 0) {
    console.log('[Background] parseAIResponse: 常规模式未匹配到答案，尝试直接提取单独的A/B/C/D');
    
    // 先检查是否有{A}、{B}等格式的答案
    const bracketRegex = /[\{\[（\(]([A-D])[\}\]）\)]/g;
    let bracketMatch;
    while ((bracketMatch = bracketRegex.exec(response)) !== null) {
      matched = true;
      answers.push(bracketMatch[1]);
      console.log('[Background] parseAIResponse: 找到括号中的答案:', bracketMatch[1]);
    }
    
    if (!matched || answers.length === 0) {
      // 查找单独出现的 A、B、C、D
      const simpleRegex = /\b([A-D])\b/g;
      let simpleMatches = [];
      let simpleMatch;
      while ((simpleMatch = simpleRegex.exec(response)) !== null) {
        simpleMatches.push(simpleMatch[1]);
      }
      
      // 只有当找到的单个字母数量合理时才使用
      if (simpleMatches.length > 0) {
        console.log('[Background] parseAIResponse: 尝试直接提取简单字母答案:', simpleMatches);
        
        // 如果字母数量过多，只取前面一部分
        const uniqueLetters = [...new Set(simpleMatches)];
        if (uniqueLetters.length <= 3) {
          answers.push(...uniqueLetters);
          matched = true;
        } else {
          // 简单地取前3个不同的字母
          answers.push(...uniqueLetters.slice(0, 3));
          matched = true;
        }
      }
    }
  }
  
  if (answers.length === 0) {
    console.error('[Background] parseAIResponse: 未能解析到答案，原始响应:', response);
  } else {
    console.log('[Background] parseAIResponse: 成功解析答案:', answers);
  }
  
  return answers;
}

// 监听来自content script的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'queryAI') {
    const { questions, apiKey } = request;
    
    // 记录请求信息
    console.log('[Background] 收到AI查询请求:', {
      action: request.action,
      questionsCount: questions ? questions.length : 0,
      hasApiKey: !!apiKey
    });
    
    // 检查发送者是否有效
    if (!sender || !sender.tab) {
      console.error('[Background] 无效的消息发送者');
      sendResponse({ success: false, error: '无效的消息发送者' });
      return true;
    }
    
    if (!questions || !Array.isArray(questions) || questions.length === 0) {
      console.error('[Background] 无效的题目数据');
      sendResponse({ success: false, error: '无效的题目数据' });
      return true;
    }
    
    if (!apiKey) {
      console.error('[Background] API密钥未设置');
      sendResponse({ success: false, error: 'API密钥未设置' });
      return true;
    }
    
    console.log('[Background] 开始处理题目组...');
    const questionGroups = groupQuestions(questions);
    console.log('[Background] 题目分组完成，共', questionGroups.length, '组');
    
    let processedGroups = 0;
    
    // 不再使用setTimout，而是使用更可靠的Promise超时模式
    const processQuestions = async () => {
      const allAnswers = [];
      
      // 发送开始处理的状态
      try {
        chrome.tabs.sendMessage(sender.tab.id, {
          action: 'updateStatus',
          status: '开始处理题目...'
        });
      } catch (statusError) {
        console.error('[Background] 发送状态更新失败:', statusError);
      }
      
      console.log('[Background] 开始处理题目...');
      
      for (const group of questionGroups) {
        try {
          // 更新当前组的处理状态
          try {
            chrome.tabs.sendMessage(sender.tab.id, {
              action: 'updateStatus',
              status: `正在处理第${processedGroups + 1}组题目...`
            });
          } catch (statusError) {
            console.warn('[Background] 发送组处理状态更新失败:', statusError);
          }
          
          console.log(`[Background] 正在处理第${processedGroups + 1}组题目...`, {
            groupSize: group.length,
            firstQuestion: group[0]?.text?.substring(0, 20) + '...'
          });
          
          const aiResponse = await queryAI(group, apiKey);
          console.log('[Background] 收到AI响应:', aiResponse);
          
          const answers = parseAIResponse(aiResponse, group);
          console.log('[Background] 解析后的答案:', answers);
          
          if (!answers || answers.length === 0) {
            console.error('[Background] AI未返回有效答案');
            
            // 尝试直接向tab发送错误状态
            try {
              chrome.tabs.sendMessage(sender.tab.id, {
                action: 'updateStatus',
                status: 'AI未返回有效答案，请重试'
              });
            } catch (updateError) {
              console.warn('[Background] 发送AI未返回答案状态更新失败:', updateError);
            }
            
            throw new Error('AI未返回有效答案，请重试');
          }
          
          allAnswers.push(...answers);
          processedGroups++;
          
          // 发送进度更新
          try {
            chrome.tabs.sendMessage(sender.tab.id, {
              action: 'updateProgress',
              progress: Math.round((processedGroups / questionGroups.length) * 100)
            });
          } catch (progressError) {
            console.warn('[Background] 发送进度更新失败:', progressError);
          }
        } catch (groupError) {
          console.error('[Background] 处理题目组时出错:', groupError);
          throw groupError;
        }
      }
      
      if (allAnswers.length !== questions.length) {
        console.error('[Background] 答案数量与题目数量不匹配:', {
          answersCount: allAnswers.length,
          questionsCount: questions.length
        });
        
        // 填充缺失的答案，而不是抛出错误
        console.log('[Background] 正在填充缺失的答案...');
        while (allAnswers.length < questions.length) {
          console.log(`[Background] 添加默认答案 "未知" 到位置 ${allAnswers.length + 1}`);
          allAnswers.push("未知");
        }
        
        // 如果答案过多，则截断
        if (allAnswers.length > questions.length) {
          console.log(`[Background] 答案过多，截断到 ${questions.length} 个`);
          allAnswers = allAnswers.slice(0, questions.length);
        }
      }
      
      console.log('[Background] 所有题目处理完成，答案:', allAnswers);
      
      // 发送完成状态
      try {
        console.log('[Background] 所有题目处理完成，发送完成状态更新');
        // 向当前标签页发送状态更新
        chrome.tabs.sendMessage(sender.tab.id, {
          action: 'updateStatus',
          status: '解答完成，已显示全部答案'
        });
        
        // 重复多次向popup窗口广播完成状态，确保至少一次能成功传递
        const broadcastCompletion = () => {
          console.log('[Background] 广播完成状态到所有监听者');
          chrome.runtime.sendMessage({
            action: 'updatePopupStatus',
            status: '解答完成，已显示全部答案',
            timestamp: Date.now() // 添加时间戳避免缓存
          }).catch(err => {
            console.log('[Background] 向popup发送状态可能失败，这是正常的:', err.message);
          });
        };
        
        // 立即发送一次
        broadcastCompletion();
        
        // 然后延迟多次发送，提高成功率
        setTimeout(broadcastCompletion, 300);
        setTimeout(broadcastCompletion, 800);
        setTimeout(broadcastCompletion, 1500);
      } catch (statusError) {
        console.warn('[Background] 发送完成状态更新失败:', statusError);
      }
      
      return { success: true, answers: allAnswers };
    };
    
    (async () => {
      try {
        const result = await processQuestions();
        console.log('[Background] 正在发送成功响应到content script...');
        
        try {
          sendResponse(result);
          console.log('[Background] 成功响应已发送');
        } catch (responseError) {
          // 忽略响应错误，因为这时内容可能已经显示在页面上
          console.log('[Background] 注意：发送响应时出现通道关闭错误，但这不影响答案显示');
        }
      } catch (error) {
        console.error('[Background] AI查询过程出错:', error);
        console.log('[Background] 正在发送错误响应到content script:', error.message);
        
        try {
          sendResponse({
            success: false,
            error: error.message || '未知错误',
            processedCount: processedGroups
          });
          console.log('[Background] 错误响应已发送');
        } catch (responseError) {
          console.error('[Background] 发送错误响应时出错:', responseError);
        }
      }
    })();
    
    // 注意：即使sendResponse可能在稍后失败，答案仍然会通过内容脚本显示在页面上
    return true; // 保持消息通道开放
  }
});

// 监听进度更新
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'progressUpdate') {
    // 转发进度更新到content script
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: 'updateProgress',
          progress: request.progress
        });
      }
    });
  }
});

// 在文件结尾添加就绪日志
console.log('[Background] 背景脚本已加载完成，等待消息');
