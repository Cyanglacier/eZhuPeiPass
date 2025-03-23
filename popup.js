// API连接测试函数
async function testApiConnection(apiKey) {
  try {
    updateStatus('正在验证API连接...');
    
    // 直接测试API连接
    const url = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation';
    
    const headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    };
    
    const data = {
      'model': 'qwen-turbo',
      'input': {
        'messages': [
          {
            'role': 'system',
            'content': '你好'
          },
          {
            'role': 'user',
            'content': '这是一个简单的API连接测试'
          }
        ]
      },
      'parameters': {
        'result_format': 'message'
      }
    };
    
    updateStatus('发送API测试请求...');
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    
    const response = await fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(data),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      const errorText = await response.text();
      updateStatus(`API连接测试失败: ${response.status}`);
      return false;
    }
    
    const result = await response.json();
    if (result.output && result.output.choices && result.output.choices[0] && result.output.choices[0].message) {
      updateStatus('API连接测试成功');
      return true;
    } else {
      updateStatus('API返回数据格式错误');
      return false;
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      updateStatus('API连接测试超时');
    } else {
      updateStatus(`API连接测试异常: ${error.message}`);
    }
    return false;
  }
}

// 添加全局错误处理器，阻止错误显示在popup标题上
window.addEventListener('error', function(event) {
  // 阻止错误冒泡到Chrome UI
  event.preventDefault();
  event.stopPropagation();
  // 打印到控制台但不显示在UI上
  console.error('捕获到错误 (已阻止显示):', event.error || event.message);
  return true; // 阻止默认处理
});

// 捕获Promise未处理的rejection
window.addEventListener('unhandledrejection', function(event) {
  // 阻止错误冒泡到Chrome UI
  event.preventDefault();
  event.stopPropagation(); 
  // 打印到控制台但不显示在UI上
  console.error('捕获到未处理的Promise错误 (已阻止显示):', event.reason);
  return true; // 阻止默认处理
});

// 添加消息监听器，接收来自content.js的状态更新
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'updatePopupStatus' && request.status) {
    // 如果消息包含解答完成，锁定状态
    if (request.status.includes('解答完成') || request.status.includes('已显示全部答案')) {
      statusLocked = true;
      console.log('收到完成消息，锁定状态:', request.status);
    }
    
    updateStatus(request.status);
    return true;
  }
});

// 添加全局变量跟踪当前状态
let currentStatus = '';
let statusLocked = false;

// 添加一个启用"开始解答"按钮的函数（移至全局作用域）
function enableRefreshButton() {
  const refreshBtn = document.getElementById('refresh-btn');
  if (!refreshBtn) return;
  
  refreshBtn.disabled = false;
  refreshBtn.style.backgroundColor = '#2196F3';
  refreshBtn.style.cursor = 'pointer';
  refreshBtn.textContent = '开始解答';
}

document.addEventListener('DOMContentLoaded', function() {
  const modelSelect = document.getElementById('model-select');
  const refreshBtn = document.getElementById('refresh-btn');
  const apiKeySection = document.querySelector('.api-key-section');
  const apiKeyInput = document.getElementById('api-key-input');
  const saveApiKeyBtn = document.getElementById('save-api-key-btn');
  const apiKeyStatus = document.getElementById('api-key-status');
  const testApiBtn = document.getElementById('debug-test-api-btn');
  const clearApiKeyBtn = document.getElementById('clear-api-key-btn');

  // 设置初始状态为等待用户操作
  const status = document.getElementById('status');
  if (status) {
    status.textContent = '请点击"开始解答"按钮开始分析题目';
    currentStatus = status.textContent;
  }
  
  // 从本地存储读取最新状态
  chrome.storage.local.get(['currentStatus'], function(result) {
    if (result.currentStatus) {
      console.log('从本地存储读取状态:', result.currentStatus);
      updateStatus(result.currentStatus);
      
      // 如果是完成状态，确保按钮可用
      if (result.currentStatus.includes('解答完成') || 
          result.currentStatus.includes('已显示全部答案') ||
          result.currentStatus.includes('处理进度: 100%')) {
        enableRefreshButton();
      }
    }
  });
  
  // 添加定时保护，防止状态被错误覆盖
  setInterval(() => {
    const status = document.getElementById('status');
    if (!status) return;
    
    // 如果状态已锁定但当前显示的是错误信息，恢复正确状态
    if (statusLocked && (
      status.textContent.includes('无法连接') || 
      status.textContent.includes('错误') || 
      status.textContent.includes('Error') ||
      status.textContent.includes('failed')
    )) {
      console.log('检测到错误覆盖了锁定状态，恢复为:', currentStatus);
      status.textContent = currentStatus;
    }
    
    // 检查进度100%或处理完成后按钮是否仍被禁用
    const refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn && refreshBtn.disabled && (
      status.textContent.includes('处理进度: 100%') ||
      status.textContent.includes('解答完成') ||
      status.textContent.includes('已显示全部答案')
    )) {
      console.log('检测到处理已完成但按钮仍被禁用，恢复按钮状态');
      enableRefreshButton();
    }
  }, 100); // 每100毫秒检查一次

  // 检查是否已存储API密钥
  chrome.storage.local.get(['apiKey'], function(result) {
    if (result.apiKey) {
      try {
        // 验证API密钥格式
        if (!result.apiKey || !result.apiKey.startsWith('sk-')) {
          throw new Error('API密钥格式无效');
        }

        apiKeyStatus.textContent = '已保存API密钥';
        apiKeyStatus.style.color = '#4CAF50';
        apiKeyInput.style.display = 'none';
        saveApiKeyBtn.style.display = 'none';
        clearApiKeyBtn.style.display = 'block';
      } catch (error) {
        console.error('密钥验证失败:', error);
        const errorMessage = error.message || '未知错误';
        apiKeyStatus.textContent = `密钥验证失败: ${errorMessage}`;
        apiKeyStatus.style.color = '#f44336';
        apiKeyInput.style.display = 'block';
        saveApiKeyBtn.style.display = 'block';
        clearApiKeyBtn.style.display = 'none';
      }
    } else {
      apiKeyInput.style.display = 'block';
      saveApiKeyBtn.style.display = 'block';
      clearApiKeyBtn.style.display = 'none';
    }
  });

  // 测试API连接按钮
  testApiBtn.addEventListener('click', async () => {
    try {
      updateStatus('开始测试API连接...');
      
      const result = await chrome.storage.local.get(['apiKey']);
      if (!result.apiKey) {
        updateStatus('请先设置API密钥');
        return;
      }
      
      const connectionSuccess = await testApiConnection(result.apiKey);
      if (connectionSuccess) {
        updateStatus('API连接测试成功');
        apiKeyStatus.textContent = 'API密钥有效，连接正常';
        apiKeyStatus.style.color = '#4CAF50';
      } else {
        updateStatus('API连接测试失败');
        apiKeyStatus.textContent = 'API连接测试失败';
        apiKeyStatus.style.color = '#f44336';
      }
    } catch (error) {
      updateStatus(`API测试失败: ${error.message}`);
    }
  });

  // 保存API密钥
  saveApiKeyBtn.addEventListener('click', async () => {
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
      apiKeyStatus.textContent = '请输入API密钥';
      apiKeyStatus.style.color = '#f44336';
      return;
    }
    
    if (!apiKey.startsWith('sk-')) {
      apiKeyStatus.textContent = '无效的API密钥格式，密钥必须以sk-开头';
      apiKeyStatus.style.color = '#f44336';
      return;
    }

    try {
      // 更新状态
      apiKeyStatus.textContent = '正在保存密钥...';
      apiKeyStatus.style.color = '#2196F3';
      updateStatus('正在保存API密钥...');
      
      // 直接保存密钥，跳过API验证
      await chrome.storage.local.set({ apiKey: apiKey });
      
      // 验证保存是否成功
      const savedData = await chrome.storage.local.get(['apiKey']);
      if (!savedData.apiKey || !savedData.apiKey.startsWith('sk-')) {
        throw new Error('密钥保存失败');
      }

      // 更新UI
      apiKeyStatus.textContent = 'API密钥已保存';
      apiKeyStatus.style.color = '#4CAF50';
      apiKeyInput.value = '';
      apiKeyInput.style.display = 'none';
      saveApiKeyBtn.style.display = 'none';
      clearApiKeyBtn.style.display = 'block';
      
      updateStatus('API密钥保存成功');
      
      // 尝试测试API连接（但不阻塞UI更新）
      setTimeout(() => {
        testApiConnection(apiKey);
      }, 500);
    } catch (error) {
      console.error('保存API密钥时出错:', error);
      apiKeyStatus.textContent = `保存失败: ${error.message || '请重试'}`;
      apiKeyStatus.style.color = '#f44336';
      updateStatus(`API密钥保存失败: ${error.message}`);
    }
  });
  
  // 清除密钥按钮点击事件
  clearApiKeyBtn.addEventListener("click", async () => {
    // 添加确认
    if (!confirm('确定要删除已保存的API密钥吗？')) {
      return;
    }
    
    try {
      await chrome.storage.local.remove(['apiKey']);
      apiKeyStatus.textContent = '密钥已清除';
      apiKeyStatus.style.color = '#f44336';
      apiKeyInput.style.display = 'block';
      saveApiKeyBtn.style.display = 'block';
      clearApiKeyBtn.style.display = 'none';
    } catch (error) {
      console.error('清除API密钥时出错:', error);
      apiKeyStatus.textContent = '清除失败，请重试';
      apiKeyStatus.style.color = '#f44336';
    }
  });

  // 不再自动初始化查询答案
  // queryQuestions();
  
  // "开始解答"按钮点击事件
  refreshBtn.addEventListener('click', async () => {
    // 禁用按钮，防止重复点击
    refreshBtn.disabled = true;
    refreshBtn.style.backgroundColor = '#99ccff';
    refreshBtn.style.cursor = 'not-allowed';
    refreshBtn.textContent = '正在解答中...';
    
    // 检查API密钥是否存在
    try {
      const result = await chrome.storage.local.get(['apiKey']);
      if (!result.apiKey) {
        updateStatus('请先设置API密钥');
        // 恢复按钮
        enableRefreshButton();
        return;
      }
      
      // 检查API状态
      updateStatus('正在检查API连接...');
      
      // 不再使用background.js验证，而是直接测试
      const connectionSuccess = await testApiConnection(result.apiKey);
      
      if (!connectionSuccess) {
        updateStatus('API连接失败，无法查询');
        // 恢复按钮
        enableRefreshButton();
        return;
      }
      
      updateStatus('API连接正常，开始查询');
      
      // 清除页面上已有的答案提示
      const existingAnswers = document.querySelectorAll('.answer-hint');
      existingAnswers.forEach(answer => answer.remove());
      
      // 重新查询答案
      queryQuestions();
    } catch (error) {
      updateStatus(`错误: ${error.message}`);
      // 恢复按钮
      enableRefreshButton();
    }
  });
});

function queryQuestions() {
  updateStatus('开始分析题目...');
  
  chrome.storage.local.get(['apiKey'], function(result) {
    if (!result.apiKey) {
      updateStatus('请先设置API密钥');
      return;
    }

    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      if (!tabs || !tabs[0]) {
        updateStatus('无法获取当前标签页');
        return;
      }

      chrome.tabs.sendMessage(tabs[0].id, {action: 'getQuestions'}, function(response) {
        if (chrome.runtime.lastError) {
          updateStatus('无法连接到页面: ' + chrome.runtime.lastError.message);
          return;
        }

        if (!response) {
          updateStatus('未收到页面响应');
          return;
        }

        if (response.error) {
          updateStatus('错误: ' + response.error);
          return;
        }

        if (response.questions && response.questions.length > 0) {
          updateStatus(`检测到 ${response.questions.length} 个题目，正在分析...`);
        } else {
          updateStatus('未检测到题目，请确保页面已加载完成');
        }
      });
    });
  });
}

function updateStatus(message) {
  // 重要错误信息，即使状态已锁定也显示
  const criticalErrors = [
    'AI未返回有效答案',
    'AI没有生成答案',
    '未能解析到答案'
  ];
  
  // 检查是否是重要错误信息
  const isCriticalError = criticalErrors.some(errText => message.includes(errText));
  
  // 如果是重要错误，解除状态锁定
  if (isCriticalError) {
    statusLocked = false;
    console.log('检测到重要错误，解除状态锁定:', message);
    // 恢复按钮
    enableRefreshButton();
  }
  
  // 如果是解答完成的消息，锁定状态
  if (message.includes('解答完成') || message.includes('已显示全部答案')) {
    statusLocked = true;
    console.log('状态已锁定:', message);
    // 恢复按钮
    enableRefreshButton();
  }
  
  // 处理进度为100%也视为完成
  if (message.includes('处理进度: 100%')) {
    console.log('进度达到100%，恢复按钮状态');
    // 恢复按钮但不锁定状态，等待最终完成消息
    enableRefreshButton();
  }
  
  // 如果包含错误信息，恢复按钮
  if (message.includes('错误') || message.includes('失败') || message.includes('未检测到题目')) {
    enableRefreshButton();
  }
  
  // 如果状态已锁定且当前是错误消息，不更新
  if (statusLocked && !isCriticalError && (
      message.includes('错误') || 
      message.includes('无法连接') ||
      message.includes('failed') ||
      message.includes('error')
    )) {
    console.log('状态已锁定，忽略一般错误消息:', message);
    return;
  }
  
  // 否则正常更新状态
  const status = document.getElementById('status');
  if (status) {
    status.textContent = message;
    currentStatus = message;
  }
  console.log(message); // 保留控制台日志以便调试
}